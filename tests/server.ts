// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface TestServer {
  baseUrl: string;
  requests: ReceivedRequest[];
  close: () => Promise<void>;
}

/**
 * A real HTTP server on a random port. Tests assert on actual exchanges rather
 * than on a mocked fetch, so a change in how the SDK builds requests is caught.
 */
export async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, index: number) => void,
): Promise<TestServer> {
  const requests: ReceivedRequest[] = [];

  const server = createServer((req, res) => {
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

  // Idempotent: a suite whose `afterEach` closes a server shared across
  // describe blocks would otherwise fail with "Server is not running" for any
  // block that never started one.
  let closed = false;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
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

/** Writes a JSON response. */
export function json(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}
