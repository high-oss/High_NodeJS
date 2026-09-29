// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';

/** One accepted connection on the fake feed server. */
export interface ServerSocket {
  /** Every frame received, parsed, in arrival order. An array is flattened into its elements. */
  readonly received: unknown[];
  /** The raw `ws` socket, for tests that need to attach their own `message` handler. */
  readonly raw: WebSocket;
  send(frame: unknown): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
}

export interface FeedTestServer {
  readonly wsBaseUrl: string;
  /** Every connection accepted so far, in order — index 0 is the first connect, index 1 the first reconnect, etc. */
  readonly sockets: ServerSocket[];
  close(): Promise<void>;
}

/**
 * A real local WebSocket server for feed tests — never a mocked socket, per
 * this repo's testing convention. `onConnection` runs for every accepted
 * connection, including reconnects, so a test can give the Nth connection
 * different behaviour than the first.
 */
export function startFeedServer(onConnection: (socket: ServerSocket) => void): Promise<FeedTestServer> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    const sockets: ServerSocket[] = [];

    wss.on('connection', (ws) => {
      const received: unknown[] = [];
      const socket: ServerSocket = {
        received,
        raw: ws,
        send: (frame) => ws.send(JSON.stringify(frame)),
        close: (code, reason) => ws.close(code, reason),
        terminate: () => ws.terminate(),
      };
      ws.on('message', (data) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.toString('utf8'));
        } catch {
          return;
        }
        if (Array.isArray(parsed)) received.push(...parsed);
        else received.push(parsed);
      });
      sockets.push(socket);
      onConnection(socket);
    });

    wss.on('listening', () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        wsBaseUrl: `ws://127.0.0.1:${port}`,
        sockets,
        close: () =>
          new Promise<void>((res, rej) => {
            for (const client of wss.clients) client.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export interface Limits {
  maxScripPerConn: number;
  maxScripPerReq: number;
}

const DEFAULT_LIMITS: Limits = { maxScripPerConn: 500, maxScripPerReq: 200 };

/** Sends a successful `cn` acknowledgement. */
export function sendAuthOk(socket: ServerSocket, limits: Limits = DEFAULT_LIMITS): void {
  socket.send([
    {
      type: 'cn', stat: 'Ok', msg: 'successful', stCode: 200,
      maxScripPerConn: limits.maxScripPerConn, maxScripPerReq: limits.maxScripPerReq, sType: 'v2.0',
    },
  ]);
}

/** Sends a rejected `cn` acknowledgement. */
export function sendAuthNotOk(socket: ServerSocket, stCode: number, msg: string): void {
  socket.send([{ type: 'cn', stat: 'NotOk', msg, stCode }]);
}

/** Sends a sub/unsub acknowledgement. */
export function sendSubUnsubAck(
  socket: ServerSocket,
  type: 'sub' | 'unsub',
  stat: 'Ok' | 'NotOk' = 'Ok',
  stCode = 200,
  msg = 'successful',
): void {
  socket.send([{ type, stat, msg, stCode }]);
}

/**
 * Wires the ordinary happy path onto a connection: auth always succeeds, and
 * every `*s`/`*u` request is acknowledged `Ok` in reply order. Tests that need
 * different behaviour (a `NotOk`, a delayed ack, an ignored request) skip this
 * and script the connection themselves.
 */
export function autoAcknowledge(socket: ServerSocket, limits: Limits = DEFAULT_LIMITS): void {
  socket.raw.on('message', (data) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString('utf8'));
    } catch {
      return;
    }
    const record = parsed as Record<string, unknown>;
    const type = record['type'];
    if (type === 'cn') {
      sendAuthOk(socket, limits);
    } else if (typeof type === 'string' && type.endsWith('s')) {
      sendSubUnsubAck(socket, 'sub');
    } else if (typeof type === 'string' && type.endsWith('u')) {
      sendSubUnsubAck(socket, 'unsub');
    }
  });
}
