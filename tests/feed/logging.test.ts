// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import type { LogSink } from '../../src/logger.js';
import { autoAcknowledge, type FeedTestServer, startFeedServer } from './server.js';

let server: FeedTestServer | undefined;
let feed: HighFeed | undefined;

afterEach(async () => {
  await feed?.close();
  await server?.close();
  server = undefined;
  feed = undefined;
});

const SECRET_TOKEN = 'super-secret-access-token-xyz';

function collectingSink(): { sink: LogSink; lines: string[] } {
  const lines: string[] = [];
  const record = (message: string, detail?: unknown) => {
    lines.push(detail === undefined ? message : `${message} ${JSON.stringify(detail)}`);
  };
  return { sink: { error: record, warn: record, info: record, debug: record }, lines };
}

describe('credentials never reach the log', () => {
  it('never logs the access token, even at debug level with ticks flowing', async () => {
    server = await startFeedServer((socket) => autoAcknowledge(socket));
    const { sink, lines } = collectingSink();

    feed = new HighFeed({
      accessToken: SECRET_TOKEN,
      wsBaseUrl: server.wsBaseUrl,
      logLevel: 'debug',
      logSink: sink,
    });

    await feed.connect();
    await feed.subscribeQuotes(['NSE@15563']);

    const tickPromise = new Promise((resolve) => feed!.once('quote', resolve));
    server.sockets[0]!.send([{ e: 'nse_cm', tk: '15563', name: 'sf', ltp: '10' }]);
    await tickPromise;

    await feed.close();

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SECRET_TOKEN);
    }
  });
});
