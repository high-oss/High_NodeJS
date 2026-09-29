// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import { HighFeedError } from '../../src/feed/errors.js';
import { autoAcknowledge, type FeedTestServer, startFeedServer } from './server.js';

let server: FeedTestServer | undefined;
let feed: HighFeed | undefined;

afterEach(async () => {
  await feed?.close();
  await server?.close();
  server = undefined;
  feed = undefined;
});

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil: timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function subscribeRequests(socket: FeedTestServer['sockets'][number]): Record<string, unknown>[] {
  return socket.received.filter(
    (m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && typeof (m as Record<string, unknown>)['type'] === 'string' &&
      ((m as Record<string, unknown>)['type'] as string).endsWith('s') &&
      (m as Record<string, unknown>)['type'] !== 'cn',
  );
}

describe('subscribe: wire translation', () => {
  it('sends the equity topic as segment|token', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const [request] = subscribeRequests(server.sockets[0]!);
    expect(request).toMatchObject({ type: 'mws', scrips: 'nse_cm|15563', channelnum: 1 });
  });

  it('sends an index topic as segment|name, subscribed under kind "index"', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeIndices(['BSE@19000']);

    const [request] = subscribeRequests(server.sockets[0]!);
    expect(request).toMatchObject({ type: 'ifs', scrips: 'bse_cm|SENSEX' });
  });

  it('rejects an index key subscribed under kind "quote", naming the key', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.subscribeQuotes(['NSE@26000'])).rejects.toThrow(/NSE@26000.*kind: "index"/s);
    expect(subscribeRequests(server.sockets[0]!)).toEqual([]);
  });

  it('rejects a non-index key subscribed under kind "index"', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.subscribeIndices(['NSE@15563'])).rejects.toThrow(/NSE@15563/);
    expect(subscribeRequests(server.sockets[0]!)).toEqual([]);
  });

  it('rejects an index key subscribed under kind "depth" too, not just "quote"', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.subscribeDepth(['BSE@19000'])).rejects.toThrow(/BSE@19000.*kind: "index"/s);
    expect(subscribeRequests(server.sockets[0]!)).toEqual([]);
  });

  it('rejects a scripKey the scrip master resolves ambiguously, naming both candidates', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.subscribeIndices(['NSE@26002'])).rejects.toThrow(/Nifty FMCG/);
    await expect(feed.subscribeIndices(['NSE@26002'])).rejects.toThrow(/Nifty50 PR 2x Lev/);
    expect(subscribeRequests(server.sockets[0]!)).toEqual([]);
  });

  it('rejects an unsupported prefix and never puts a frame on the wire for it', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.subscribeQuotes(['XYZ@1'])).rejects.toThrow(HighFeedError);
    expect(subscribeRequests(server.sockets[0]!)).toEqual([]);
  });
});

describe('subscribe: server-declared limits', () => {
  it('splits a subscription across requests to honour maxScripPerReq', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket, { maxScripPerConn: 10, maxScripPerReq: 2 }));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await feed.subscribeQuotes(['NSE@1', 'NSE@2', 'NSE@3']);

    const requests = subscribeRequests(server.sockets[0]!);
    expect(requests).toHaveLength(2);
    expect((requests[0]!['scrips'] as string).split('&')).toHaveLength(2);
    expect((requests[1]!['scrips'] as string).split('&')).toHaveLength(1);
  });

  it('refuses a subscription that would exceed maxScripPerConn, without sending a frame', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket, { maxScripPerConn: 3, maxScripPerReq: 10 }));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await feed.subscribeQuotes(['NSE@1', 'NSE@2', 'NSE@3']);
    const before = subscribeRequests(server.sockets[0]!).length;

    await expect(feed.subscribeQuotes(['NSE@4'])).rejects.toThrow(/maxScripPerConn/);
    expect(subscribeRequests(server.sockets[0]!)).toHaveLength(before);
  });

  it('does not re-count or re-send an already-subscribed key', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket, { maxScripPerConn: 2, maxScripPerReq: 10 }));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await feed.subscribeQuotes(['NSE@1', 'NSE@2']);
    await expect(feed.subscribeQuotes(['NSE@1'])).resolves.toBeUndefined();
    expect(subscribeRequests(server.sockets[0]!)).toHaveLength(1);
  });
});

function unsubscribeRequests(socket: FeedTestServer['sockets'][number]): Record<string, unknown>[] {
  return socket.received.filter(
    (m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>)['type'] === 'mwu',
  );
}

describe('unsubscribe and snapshot', () => {
  it('unsubscribeQuotes sends mwu and frees the slot against maxScripPerConn', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket, { maxScripPerConn: 1, maxScripPerReq: 10 }));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await feed.subscribeQuotes(['NSE@1']);
    await feed.unsubscribeQuotes(['NSE@1']);

    expect(unsubscribeRequests(server.sockets[0]!)).toHaveLength(1);
    // The slot freed by unsubscribing is available again under the same 1-scrip limit.
    await expect(feed.subscribeQuotes(['NSE@2'])).resolves.toBeUndefined();
  });

  it('snapshotQuotes/snapshotDepth/snapshotIndices refuse a key that was never subscribed', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();

    await expect(feed.snapshotQuotes(['NSE@1'])).rejects.toThrow(/subscribe to it first/);
    await expect(feed.snapshotDepth(['NSE@1'])).rejects.toThrow(/subscribe to it first/);
    await expect(feed.snapshotIndices(['BSE@19000'])).rejects.toThrow(/subscribe to it first/);
  });

  it('snapshotQuotes sends a request frame for an already-subscribed key', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@1']);

    await feed.snapshotQuotes(['NSE@1']);
    // A snapshot request gets no protocol acknowledgement (see doSnapshot's
    // comment), so resolving snapshotQuotes() only means the frame was handed
    // to the socket — wait briefly for the real TCP write to actually land.
    await waitUntil(() => server!.sockets[0]!.received.some((m) => (m as Record<string, unknown>)['type'] === 'mwsp'));

    const snapshotFrames = server.sockets[0]!.received.filter(
      (m) => (m as Record<string, unknown>)['type'] === 'mwsp',
    );
    expect(snapshotFrames).toEqual([{ type: 'mwsp', scrips: 'nse_cm|1' }]);
  });
});
