// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { HighApiError } from '../src/errors.js';
import { request } from '../src/http.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const configFor = (s: TestServer, overrides = {}) =>
  resolveConfig({ baseUrl: s.baseUrl, accessToken: 'tok', apiKey: 'key', ...overrides }, {});

describe('request', () => {
  it('unwraps the envelope and returns only data', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'a1b2c3', data: { orderId: '1' } }));
    const data = await request<{ orderId: string }>(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    expect(data).toEqual({ orderId: '1' });
  });

  it('sends the bearer token for bearer operations and no api key', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(configFor(server), { method: 'GET', path: '/orders/list', auth: 'bearer' });
    expect(server.requests[0]!.headers.authorization).toBe('Bearer tok');
    expect(server.requests[0]!.headers['x-api-key']).toBeUndefined();
  });

  it('sends the api key for apiKey operations and no bearer token', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(configFor(server), { method: 'GET', path: '/auth/generate-access-token', auth: 'apiKey' });
    expect(server.requests[0]!.headers['x-api-key']).toBe('key');
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('fails before sending when the required credential is missing', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    const config = resolveConfig({ baseUrl: server.baseUrl }, {});
    await expect(
      request(config, { method: 'GET', path: '/orders/list', auth: 'bearer' }),
    ).rejects.toThrow(/accessToken/);
    expect(server.requests).toHaveLength(0);
  });

  it('serialises a JSON body and sets content-type', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: {} }));
    await request(configFor(server), {
      method: 'POST', path: '/orders', auth: 'bearer', body: { quantity: 10 },
    });
    expect(server.requests[0]!.body).toBe('{"quantity":10}');
    expect(server.requests[0]!.headers['content-type']).toMatch(/application\/json/);
  });

  it('appends defined query parameters and skips undefined ones', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(configFor(server), {
      method: 'GET', path: '/auth/generate-access-token', auth: 'apiKey',
      query: { clientId: 'C1', tOtp: 123456, unused: undefined },
    });
    expect(server.requests[0]!.url).toContain('clientId=C1');
    expect(server.requests[0]!.url).toContain('tOtp=123456');
    expect(server.requests[0]!.url).not.toContain('unused');
  });

  it('maps an error envelope to HighApiError', async () => {
    server = await startServer((_req, res) =>
      json(res, 400, { requestId: 'a1b2c3', code: 'ORDER_REJECTED', message: 'Insufficient funds' }));
    const error = await request(configFor(server), { method: 'POST', path: '/orders', auth: 'bearer' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).code).toBe('ORDER_REJECTED');
    expect((error as HighApiError).requestId).toBe('a1b2c3');
  });

  // Review Focus 3.
  it('turns a non-JSON error body into HighApiError, not a SyntaxError', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html><body>502 Bad Gateway</body></html>');
    });
    const error = await request(
      configFor(server, { maxRetries: 0 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).status).toBe(502);
    expect((error as Error).name).not.toBe('SyntaxError');
  });

  it('turns a 204 with no body into undefined rather than a parse error', async () => {
    server = await startServer((_req, res) => { res.writeHead(204); res.end(); });
    const data = await request(configFor(server), {
      method: 'DELETE', path: '/orders/1', auth: 'bearer',
    });
    expect(data).toBeUndefined();
  });

  it('times out with HighApiError rather than hanging', async () => {
    server = await startServer(() => { /* never responds */ });
    const error = await request(
      configFor(server, { timeoutMs: 50, maxRetries: 0 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).status).toBe(0);
    expect((error as Error).message).toMatch(/timed out/i);
  });

  it('sends a User-Agent identifying the SDK', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(configFor(server), { method: 'GET', path: '/orders/list', auth: 'bearer' });
    expect(server.requests[0]!.headers['user-agent']).toMatch(/high-sdk-node/);
  });
});

describe('logging', () => {
  const capture = () => {
    const lines: string[] = [];
    const push = (m: string, d?: unknown) =>
      lines.push(d === undefined ? m : `${m} ${JSON.stringify(d)}`);
    return { lines, sink: { error: push, warn: push, info: push, debug: push } };
  };

  it('prints nothing by default', async () => {
    const { lines, sink } = capture();
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(configFor(server, { logSink: sink }), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    expect(lines).toEqual([]);
  });

  it('logs the request and the response status at debug', async () => {
    const { lines, sink } = capture();
    server = await startServer((_req, res) => json(res, 200, { requestId: 'a1b2c3', data: true }));
    await request(configFor(server, { logLevel: 'debug', logSink: sink }), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    const all = lines.join('\n');
    expect(all).toMatch(/GET/);
    expect(all).toMatch(/orders\/list/);
    expect(all).toMatch(/200/);
  });

  // The reason logging goes through one module: a caller shipping debug logs to
  // an aggregator must not ship their credentials with them.
  it('never logs the bearer token, the api key or the TOTP', async () => {
    const { lines, sink } = capture();
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    await request(
      configFor(server, { logLevel: 'debug', logSink: sink, accessToken: 'SECRET-TOKEN', apiKey: 'SECRET-KEY' }),
      {
        method: 'GET', path: '/auth/generate-access-token', auth: 'apiKey',
        query: { clientId: 'C1', tOtp: '123456' },
      },
    );
    const all = lines.join('\n');
    expect(all).not.toContain('SECRET-TOKEN');
    expect(all).not.toContain('SECRET-KEY');
    expect(all).not.toContain('123456');
    expect(all).toContain('REDACTED');
  });

  it('warns when it retries', async () => {
    const { lines, sink } = capture();
    server = await startServer((_req, res, index) => {
      if (index === 0) return json(res, 503, { code: 'SERVICE_UNAVAILABLE' });
      return json(res, 200, { requestId: 'r', data: true });
    });
    await request(configFor(server, { logLevel: 'warn', logSink: sink }), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    expect(lines.join('\n')).toMatch(/retry/i);
  });
});
