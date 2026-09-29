// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReceivedRequest, TestServer } from './server.js';

const here = dirname(fileURLToPath(import.meta.url));
const CERT = readFileSync(join(here, 'fixtures/localhost-cert.pem'));
const KEY = readFileSync(join(here, 'fixtures/localhost-key.pem'));

/**
 * A real local HTTPS server, for the one thing a plain `http://127.0.0.1`
 * test server cannot stand in for: the instrument download's `https`-only
 * rule. Uses a self-signed loopback certificate checked in under
 * `tests/fixtures/` — callers must run with `NODE_TLS_REJECT_UNAUTHORIZED=0`
 * (see `tests/instruments.test.ts`) since nothing this small should ship a
 * CA-signed cert. This is still a real TLS handshake and a real HTTP
 * exchange over the loopback interface — `fetch` itself is never mocked.
 */
export async function startHttpsServer(
  handler: (req: IncomingMessage, res: ServerResponse, index: number) => void,
): Promise<TestServer> {
  const requests: ReceivedRequest[] = [];

  const server = createServer({ cert: CERT, key: KEY }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const index = requests.length;
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(',') : (v ?? '')]),
        ),
        body: Buffer.concat(chunks).toString('utf8'),
      });
      handler(req, res, index);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  let closed = false;

  return {
    baseUrl: `https://127.0.0.1:${port}`,
    requests,
    close: () => {
      if (closed) return Promise.resolve();
      closed = true;
      return new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
