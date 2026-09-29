// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import { autoAcknowledge, type FeedTestServer, startFeedServer } from './server.js';

let server: FeedTestServer | undefined;
let feed: HighFeed | undefined;

afterEach(async () => {
  await feed?.close();
  await server?.close();
  server = undefined;
  feed = undefined;
});

function subscribeRequests(socket: FeedTestServer['sockets'][number]): Record<string, unknown>[] {
  return socket.received.filter(
    (m): m is Record<string, unknown> =>
      typeof m === 'object' && m !== null && (m as Record<string, unknown>)['type'] === 'mws',
  );
}

describe('reconnect on transport failure', () => {
  it(
    're-authenticates and re-subscribes everything before reporting connected again',
    async () => {
      server = await startFeedServer((socket) => autoAcknowledge(socket));
      feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });

      const events: string[] = [];
      let connectedCount = 0;
      // Registered with `on` (not `once`) and read cumulatively below, rather
      // than attached with a fresh `once` after triggering the failure — a
      // reconnect on a local socket can complete in under a millisecond, well
      // inside the window it'd take a freshly-attached one-shot listener to
      // miss the event it was waiting for.
      feed.on('connected', () => {
        events.push('connected');
        connectedCount += 1;
      });
      feed.on('disconnected', () => events.push('disconnected'));
      feed.on('reconnecting', () => events.push('reconnecting'));

      await feed.connect();
      await feed.subscribeQuotes(['NSE@15563', 'NSE@22']);
      expect(server.sockets).toHaveLength(1);
      expect(connectedCount).toBe(1);

      const reconnected = new Promise<void>((resolve) => {
        const check = setInterval(() => {
          if (connectedCount === 2) {
            clearInterval(check);
            resolve();
          }
        }, 10);
      });

      // Simulate a transport failure — not a deliberate close(), not an auth rejection.
      server.sockets[0]!.terminate();
      await reconnected;

      expect(events).toEqual(['connected', 'disconnected', 'reconnecting', 'connected']);

      expect(server.sockets).toHaveLength(2);
      const secondSocket = server.sockets[1]!;
      expect(secondSocket.received[0]).toMatchObject({ type: 'cn', sessionid: 'tok' });

      const resubscribed = subscribeRequests(secondSocket);
      const allTopics = resubscribed.flatMap((r) => (r['scrips'] as string).split('&'));
      expect(allTopics.sort()).toEqual(['nse_cm|15563', 'nse_cm|22']);
    },
    10_000,
  );

  it('continues delivering ticks after reconnecting', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    feed = new HighFeed({ accessToken: 'tok', wsBaseUrl: server.wsBaseUrl });
    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    server.sockets[0]!.terminate();
    await new Promise<void>((resolve) => feed!.once('connected', () => resolve()));

    const tickPromise = new Promise((resolve) => feed!.once('quote', resolve));
    server.sockets[1]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '1' }]);
    await tickPromise;
  }, 10_000);
});
