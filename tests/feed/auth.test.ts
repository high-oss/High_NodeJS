// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import { HighFeedAuthError } from '../../src/feed/errors.js';
import { autoAcknowledge, type FeedTestServer, sendAuthNotOk, sendAuthOk, startFeedServer } from './server.js';

let server: FeedTestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('auth is a gate', () => {
  it('refuses to subscribe before connect() has resolved — nothing can race ahead of the auth frame', async () => {
    server = await startFeedServer((socket) => {
      // Reply slowly, so a client that ignored the gate would have time to jump ahead.
      socket.raw.on('message', (data) => {
        const record = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        if (record['type'] === 'cn') setTimeout(() => sendAuthOk(socket), 50);
      });
    });

    const feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    const connectPromise = feed.connect();
    await expect(feed.subscribeQuotes(['NSE@15563'])).rejects.toThrow(/not connected/i);
    await connectPromise;
    await feed.close();
  });

  it('sends the auth frame first on the wire, and subscribe frames only after its acknowledgement', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));

    const feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);
    await feed.close();

    const socket = server.sockets[0]!;
    expect(socket.received[0]).toMatchObject({ type: 'cn', sessionid: 'tok' });
    const firstSubscribeIndex = socket.received.findIndex(
      (m) => (m as Record<string, unknown>)['type'] === 'mws',
    );
    expect(firstSubscribeIndex).toBeGreaterThan(0);
  });

  it('never sends "mode" on the auth frame — it follows the data plan server-side', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    const feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.close();

    const authFrame = server.sockets[0]!.received[0] as Record<string, unknown>;
    expect(authFrame['mode']).toBeUndefined();
    expect(authFrame).toEqual({ type: 'cn', sessionid: 'tok' });
  });

  it('surfaces a NotOk ack as a typed HighFeedAuthError carrying stCode and msg, and never retries or reconnects', async () => {
    let connectionCount = 0;
    server = await startFeedServer((socket) => {
      connectionCount += 1;
      socket.raw.on('message', (data) => {
        const record = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        if (record['type'] === 'cn') sendAuthNotOk(socket, 11002, 'invalid field count');
      });
    });

    const feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    let sawReconnecting = false;
    feed.on('reconnecting', () => {
      sawReconnecting = true;
    });

    await expect(feed.connect()).rejects.toThrow(HighFeedAuthError);

    // Give any (incorrect) automatic retry loop time to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(connectionCount).toBe(1); // exactly the one connect() call above — no SDK-driven retry
    expect(sawReconnecting).toBe(false);
    await feed.close();
  });

  it('carries stCode and msg on the thrown error', async () => {
    server = await startFeedServer((socket) => {
      socket.raw.on('message', (data) => {
        const record = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
        if (record['type'] === 'cn') sendAuthNotOk(socket, 11002, 'invalid field count');
      });
    });
    const feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await expect(feed.connect()).rejects.toMatchObject({
      stCode: 11002,
      msg: 'invalid field count',
      reason: 'malformedRequest',
    });
  });
});
