// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { resolveConfig } from '../src/config.js';
import { HighApiError } from '../src/errors.js';
import { request, retryAfterMs } from '../src/http.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const configFor = (s: TestServer, overrides = {}) =>
  resolveConfig({ baseUrl: s.baseUrl, accessToken: 'tok', timeoutMs: 2000, ...overrides }, {});

describe('retry policy', () => {
  it('retries an idempotent GET on 503 and returns the eventual success', async () => {
    server = await startServer((_req, res, index) => {
      if (index === 0) return json(res, 503, { code: 'SERVICE_UNAVAILABLE', message: 'try later' });
      return json(res, 200, { requestId: 'r', data: { ok: true } });
    });
    const data = await request<{ ok: boolean }>(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    expect(data).toEqual({ ok: true });
    expect(server.requests).toHaveLength(2);
  });

  // The most important test in the SDK.
  it('never retries a write, even on 503', async () => {
    server = await startServer((_req, res) =>
      json(res, 503, { code: 'SERVICE_UNAVAILABLE', message: 'try later' }));
    await expect(
      request(configFor(server), { method: 'POST', path: '/orders', auth: 'bearer', body: {} }),
    ).rejects.toBeInstanceOf(HighApiError);
    expect(server.requests).toHaveLength(1);
  });

  it('never retries PATCH or DELETE either', async () => {
    server = await startServer((_req, res) => json(res, 503, { code: 'SERVICE_UNAVAILABLE' }));
    await expect(
      request(configFor(server), { method: 'PATCH', path: '/orders', auth: 'bearer', body: {} }),
    ).rejects.toBeInstanceOf(HighApiError);
    await expect(
      request(configFor(server), { method: 'DELETE', path: '/orders/1', auth: 'bearer' }),
    ).rejects.toBeInstanceOf(HighApiError);
    expect(server.requests).toHaveLength(2);
  });

  it('does not retry a 4xx that is not 429', async () => {
    server = await startServer((_req, res) => json(res, 400, { code: 'VALIDATION_ERROR' }));
    await expect(
      request(configFor(server), { method: 'GET', path: '/orders/list', auth: 'bearer' }),
    ).rejects.toBeInstanceOf(HighApiError);
    expect(server.requests).toHaveLength(1);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    server = await startServer((_req, res) => json(res, 500, { code: 'UNHANDLED_ERROR' }));
    const error = await request(
      configFor(server, { maxRetries: 2 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);
    expect((error as HighApiError).status).toBe(500);
    expect(server.requests).toHaveLength(3); // 1 initial + 2 retries
  });

  it('honours a numeric Retry-After on 429', async () => {
    server = await startServer((_req, res, index) => {
      if (index === 0) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        return res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }));
      }
      return json(res, 200, { requestId: 'r', data: true });
    });
    const data = await request<boolean>(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    });
    expect(data).toBe(true);
    expect(server.requests).toHaveLength(2);
  });
});

// Review Focus 2.
describe('retryAfterMs', () => {
  it('reads a delay in seconds', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('0')).toBe(0);
  });

  it('reads an HTTP-date and converts it to a delay', () => {
    const now = Date.parse('2026-09-28T10:00:00Z');
    expect(retryAfterMs('Mon, 28 Sep 2026 10:00:05 GMT', now)).toBe(5000);
  });

  it('never returns a negative delay for a date in the past', () => {
    const now = Date.parse('2026-09-28T10:00:10Z');
    expect(retryAfterMs('Mon, 28 Sep 2026 10:00:05 GMT', now)).toBe(0);
  });

  it('ignores a missing or unparseable header so backoff takes over', () => {
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs('soon')).toBeUndefined();
    expect(retryAfterMs('')).toBeUndefined();
  });
});

// Review Focus 4.
describe('cancellation', () => {
  it('surfaces a caller abort without retrying it', async () => {
    server = await startServer((_req, res) => {
      setTimeout(() => json(res, 503, { code: 'SERVICE_UNAVAILABLE' }), 1000);
    });
    const controller = new AbortController();
    const promise = request(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer', signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('caller cancelled')), 20);
    await expect(promise).rejects.toThrow(/caller cancelled/);
    expect(server.requests).toHaveLength(1);
  });

  it('reports the SDK timeout as a timeout, not as an abort', async () => {
    server = await startServer(() => { /* never responds */ });
    const error = await request(
      configFor(server, { timeoutMs: 50, maxRetries: 0 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as Error).message).toMatch(/timed out/i);
  });
});
