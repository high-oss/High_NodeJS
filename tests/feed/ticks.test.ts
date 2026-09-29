// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import type { DepthTickEvent, IndexTickEvent, QuoteTickEvent } from '../../src/feed/models.js';
import { autoAcknowledge, type FeedTestServer, startFeedServer } from './server.js';

let server: FeedTestServer | undefined;
let feed: HighFeed | undefined;

afterEach(async () => {
  await feed?.close();
  await server?.close();
  server = undefined;
  feed = undefined;
});

interface LooseEmitter {
  once(event: string, listener: (payload: unknown) => void): void;
}

function waitForEvent<T>(source: HighFeed, event: 'quote' | 'depth' | 'index'): Promise<T> {
  return new Promise((resolve) => {
    (source as unknown as LooseEmitter).once(event, (payload) => resolve(payload as T));
  });
}

describe('quote ticks: delta merge', () => {
  it('merges partial ticks into a complete typed snapshot, keyed by the caller\'s own scrip key', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const socket = server.sockets[0]!;

    const first = waitForEvent<QuoteTickEvent>(feed, 'quote');
    socket.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ts: 'RELIANCE-EQ', ltp: '1905.65', v: '1000' }]);
    const firstEvent = await first;

    expect(firstEvent.scripKey).toBe('NSE@15563');
    expect(firstEvent.data.tradingSymbol).toBe('RELIANCE-EQ');
    expect(firstEvent.data.lastTradedPrice).toBe('1905.65');
    expect(firstEvent.data.volume).toBe(1000);
    expect([...firstEvent.changedFields].sort()).toEqual(['lastTradedPrice', 'tradingSymbol', 'volume']);

    // A later delta only carries ltp — a field that did NOT change (tradingSymbol,
    // volume) must still be present and correct on the merged snapshot, not null.
    const second = waitForEvent<QuoteTickEvent>(feed, 'quote');
    socket.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '1906.10' }]);
    const secondEvent = await second;

    expect(secondEvent.data.lastTradedPrice).toBe('1906.10');
    expect(secondEvent.data.tradingSymbol).toBe('RELIANCE-EQ'); // unchanged field survives the merge
    expect(secondEvent.data.volume).toBe(1000); // unchanged field survives the merge
    expect([...secondEvent.changedFields]).toEqual(['lastTradedPrice']);
  });

  it('keeps prices as exact decimal strings — never parsed to a binary float', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const tick = waitForEvent<QuoteTickEvent>(feed, 'quote');
    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '0.10', c: '1859.05', cng: '46.60', nc: '2.51' }]);
    const event = await tick;

    expect(event.data.lastTradedPrice).toBe('0.10'); // 0.1 would lose the trailing significant zero
    // cng is absolute change, nc is the percentage — the opposite of the vendor's own sample README.
    expect(event.data.change).toBe('46.60');
    expect(event.data.changePercent).toBe('2.51');
  });

  it('parses ltt (dd/MM/yyyy) and fdtm (dd-MMM-yyyy) as IST wall-clock, trimming leading spaces', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const tick = waitForEvent<QuoteTickEvent>(feed, 'quote');
    server.sockets[0]!.send([
      { e: 'nse_cm', tk: '15563', name: 'sf', ltt: ' 29/04/2020 15:59:44', fdtm: '29-Apr-2020 17:34:36' },
    ]);
    const event = await tick;

    // 15:59:44 IST == 10:29:44 UTC (IST is UTC+5:30).
    expect(event.data.lastTradedTime?.toISOString()).toBe('2020-04-29T10:29:44.000Z');
    expect(event.data.feedTime?.toISOString()).toBe('2020-04-29T12:04:36.000Z');
  });

  it('preserves a wire field this SDK does not name, rather than dropping it', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const tick = waitForEvent<QuoteTickEvent>(feed, 'quote');
    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '10', eqt: '42' }]);
    const event = await tick;

    expect(event.data.extra?.['eqt']).toBe('42');
  });
});

describe('one frame, two events', () => {
  it('splits a FULL quote tick that carries both quote and top-of-book fields into separate quote and depth events', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const quotePromise = waitForEvent<QuoteTickEvent>(feed, 'quote');
    const depthPromise = waitForEvent<DepthTickEvent>(feed, 'depth');
    server.sockets[0]!.send([
      { e: 'nse_cm', tk: '15563', name: 'sf', ltp: '1905.65', op: '1900', bp: '1905.00', bq: '10', sp: '1905.50', bs: '20' },
    ]);

    const [quoteEvent, depthEvent] = await Promise.all([quotePromise, depthPromise]);

    expect(quoteEvent.data.lastTradedPrice).toBe('1905.65');
    expect((quoteEvent.data as unknown as Record<string, unknown>)['bestBidPrice']).toBeUndefined();

    expect(depthEvent.data.levels).toBe(1);
    expect(depthEvent.data.source).toBe('quote');
    expect(depthEvent.data.bids).toEqual([{ price: '1905.00', quantity: 10 }]);
    expect(depthEvent.data.asks).toEqual([{ price: '1905.50', quantity: 20 }]);
    // A one-level book must never look like a five-level one with empty rows.
    expect(depthEvent.data.bids).toHaveLength(1);
  });

  it('raises only a quote event when a delta touches no top-of-book field', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    let depthEvents = 0;
    feed.on('depth', () => {
      depthEvents += 1;
    });

    const quotePromise = waitForEvent<QuoteTickEvent>(feed, 'quote');
    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '1905.65' }]);
    await quotePromise;

    expect(depthEvents).toBe(0);
  });

  it('raises only a depth event when a delta touches only top-of-book fields', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    let quoteEvents = 0;
    feed.on('quote', () => {
      quoteEvents += 1;
    });

    const depthPromise = waitForEvent<DepthTickEvent>(feed, 'depth');
    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', bp: '1905.00', bq: '10' }]);
    await depthPromise;

    expect(quoteEvents).toBe(0);
  });
});

describe('five-level depth', () => {
  it('pairs level n\'s bp{n-1} price with its bno{n} order count, across both numbering bases', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeDepth(['NSE@15563']);

    const tick = waitForEvent<DepthTickEvent>(feed, 'depth');
    server.sockets[0]!.send([
      {
        e: 'nse_cm', tk: '15563', name: 'dp',
        bp: '100.00', bp1: '99.95', bp2: '99.90', bp3: '99.85', bp4: '99.80',
        bq: '10', bq1: '11', bq2: '12', bq3: '13', bq4: '14',
        bno1: '1', bno2: '2', bno3: '3', bno4: '4', bno5: '5',
        sp: '100.05', sp1: '100.10', sp2: '100.15', sp3: '100.20', sp4: '100.25',
        bs: '20', bs1: '21', bs2: '22', bs3: '23', bs4: '24',
        sno1: '6', sno2: '7', sno3: '8', sno4: '9', sno5: '10',
      },
    ]);
    const event = await tick;

    expect(event.data.levels).toBe(5);
    expect(event.data.source).toBe('depth');

    // Level 1 pairs the UNNUMBERED price/qty (bp/bq) with the numbered bno1.
    expect(event.data.bids[0]).toEqual({ price: '100.00', quantity: 10, orders: 1 });
    // Level 2 pairs bp1/bq1 with bno2 — not bno1, which is the off-by-one trap.
    expect(event.data.bids[1]).toEqual({ price: '99.95', quantity: 11, orders: 2 });
    // Level 5 pairs bp4/bq4 (the last numbered price) with bno5.
    expect(event.data.bids[4]).toEqual({ price: '99.80', quantity: 14, orders: 5 });

    expect(event.data.asks[0]).toEqual({ price: '100.05', quantity: 20, orders: 6 });
    expect(event.data.asks[4]).toEqual({ price: '100.25', quantity: 24, orders: 10 });

    expect(event.data.bids).toHaveLength(5);
    expect(event.data.asks).toHaveLength(5);
  });

  it('is delivered as a depth event distinct from the one-level quote-sourced book', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);
    await feed.subscribeDepth(['NSE@15563']);

    const events: DepthTickEvent[] = [];
    feed.on('depth', (e) => events.push(e));

    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', bp: '1', bq: '1', sp: '2', bs: '1' }]);
    server.sockets[0]!.send([
      { e: 'nse_cm', tk: '15563', name: 'dp', bp: '1', bq: '1', bno1: '1', bno2: '1', bno3: '1', bno4: '1', bno5: '1', sp: '2', bs: '1', sno1: '1', sno2: '1', sno3: '1', sno4: '1', sno5: '1' },
    ]);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toHaveLength(2);
    expect(events[0]!.data.levels).toBe(1);
    expect(events[0]!.data.source).toBe('quote');
    expect(events[1]!.data.levels).toBe(5);
    expect(events[1]!.data.source).toBe('depth');
  });
});

describe('index ticks', () => {
  it('translates an index frame into a typed IndexTick keyed by the caller\'s scrip key', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeIndices(['BSE@19000']);

    const tick = waitForEvent<IndexTickEvent>(feed, 'index');
    server.sockets[0]!.send([
      {
        e: 'bse_cm', tk: 'SENSEX', name: 'if', ts: 'SENSEX',
        iv: '73648.62', ic: '73088.33', openingprice: ' 73200.10', highprice: '73700.00', lowprice: '73150.00',
        cng: '560.29', nc: '0.77', tvalue: '29-Apr-2020 14:34:36',
      },
    ]);
    const event = await tick;

    expect(event.scripKey).toBe('BSE@19000');
    expect(event.data.indexName).toBe('SENSEX');
    expect(event.data.indexValue).toBe('73648.62');
    expect(event.data.previousClose).toBe('73088.33');
    expect(event.data.open).toBe('73200.10'); // leading space trimmed
    expect(event.data.change).toBe('560.29');
    expect(event.data.changePercent).toBe('0.77');
    expect(event.data.feedTime?.toISOString()).toBe('2020-04-29T09:04:36.000Z');
  });
});

describe('delivery: async iterable and event emitter both receive every tick', () => {
  it('yields the same ticks through the async iterator as through the event emitter', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const iterator = feed[Symbol.asyncIterator]();
    const iteratorPromise = iterator.next();
    const eventPromise = waitForEvent<QuoteTickEvent>(feed, 'quote');

    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '10' }]);

    const [iteratorResult, eventResult] = await Promise.all([iteratorPromise, eventPromise]);
    expect(iteratorResult.done).toBe(false);
    expect((iteratorResult.value as QuoteTickEvent).data.lastTradedPrice).toBe('10');
    expect(eventResult.data.lastTradedPrice).toBe('10');
  });
});
