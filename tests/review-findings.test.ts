// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Regression tests for the whole-branch review. Each pins a guarantee the
 * README or the design spec makes that the code did not keep — the suite
 * exercised each guarantee's happy path but never its composition.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ENVIRONMENTS, resolveConfig } from '../src/config.js';
import { HighApiError } from '../src/errors.js';
import { request } from '../src/http.js';
import { HighClient } from '../src/client.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

// Finding 1 (Critical): an explicit environment must beat a stray env var.
describe('config precedence', () => {
  it('an explicit environment beats HIGH_BASE_URL', () => {
    const config = resolveConfig(
      { environment: 'sandbox' },
      { HIGH_BASE_URL: 'https://openapi.high.live' },
    );
    expect(config.baseUrl).toBe(ENVIRONMENTS.sandbox.api);
  });

  it('an explicit environment beats HIGH_WS_BASE_URL too, so the hosts cannot split', () => {
    const config = resolveConfig(
      { environment: 'sandbox' },
      { HIGH_BASE_URL: 'https://openapi.high.live', HIGH_WS_BASE_URL: 'wss://openapi.high.live' },
    );
    expect(config.baseUrl).toBe(ENVIRONMENTS.sandbox.api);
    expect(config.wsBaseUrl).toBe(ENVIRONMENTS.sandbox.ws);
  });

  it('HIGH_BASE_URL still applies when no environment is given', () => {
    expect(resolveConfig({}, { HIGH_BASE_URL: 'http://localhost:9999' }).baseUrl)
      .toBe('http://localhost:9999');
  });

  it('an explicit baseUrl still wins over everything', () => {
    const config = resolveConfig(
      { environment: 'sandbox', baseUrl: 'http://localhost:1' },
      { HIGH_BASE_URL: 'https://openapi.high.live' },
    );
    expect(config.baseUrl).toBe('http://localhost:1');
  });
});

// Finding 8 (Minor, same class): every failure must be a HighApiError.
describe('option validation', () => {
  it('rejects a negative maxRetries rather than crashing mid-request', () => {
    expect(() => resolveConfig({ maxRetries: -1 }, {})).toThrow(/maxRetries/);
  });

  it('rejects a non-positive timeout', () => {
    expect(() => resolveConfig({ timeoutMs: 0 }, {})).toThrow(/timeoutMs/);
    expect(() => resolveConfig({ timeoutMs: -1 }, {})).toThrow(/timeoutMs/);
  });
});

const configFor = (s: TestServer, overrides = {}) =>
  resolveConfig({ baseUrl: s.baseUrl, accessToken: 'tok', timeoutMs: 2000, ...overrides }, {});

// Finding 2 (Important): an abort during the retry sleep was ignored entirely.
describe('cancellation during a retry sleep', () => {
  it('does not send another request after the caller aborts mid-sleep', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '3' });
      res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }));
    });
    const controller = new AbortController();
    const promise = request(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer', signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('caller cancelled')), 50);

    await expect(promise).rejects.toThrow(/caller cancelled/);
    expect(server.requests).toHaveLength(1);
  });
});

// Finding 4 (Important): Retry-After had no ceiling.
describe('retry delay ceiling', () => {
  it('gives up rather than sleeping past maxRetryDelayMs', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '86400' });
      res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }));
    });
    const startedAt = Date.now();
    const error = await request(
      configFor(server, { maxRetries: 2, maxRetryDelayMs: 100 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).status).toBe(429);
    // It must not have slept for a day, nor even for the 86400s the header asked.
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(server.requests).toHaveLength(1);
  });

  it('still honours a Retry-After inside the ceiling', async () => {
    server = await startServer((_req, res, index) => {
      if (index === 0) {
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0' });
        return res.end(JSON.stringify({ code: 'SERVICE_UNAVAILABLE' }));
      }
      return json(res, 200, { requestId: 'r', data: true });
    });
    await expect(request<boolean>(configFor(server), {
      method: 'GET', path: '/orders/list', auth: 'bearer',
    })).resolves.toBe(true);
    expect(server.requests).toHaveLength(2);
  });
});

// Finding 3 (Important): the timeout only covered the response headers.
describe('timeout covers the response body', () => {
  it('times out when the body stalls after the headers arrive', async () => {
    server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"requestId":"r","da');
      // The rest of the body never arrives within the timeout.
      setTimeout(() => res.end('ta":true}'), 3000).unref();
    });
    const startedAt = Date.now();
    const error = await request(
      configFor(server, { timeoutMs: 150, maxRetries: 0 }),
      { method: 'GET', path: '/orders/list', auth: 'bearer' },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HighApiError);
    expect((error as Error).message).toMatch(/timed out/i);
    expect(Date.now() - startedAt).toBeLessThan(2000);
  });
});

// Finding 5 (Important): credentials were enumerable on the client and resources.
describe('credential containment', () => {
  it('does not serialise credentials through JSON.stringify', () => {
    const client = new HighClient({ accessToken: 'SECRET-TOKEN', apiKey: 'SECRET-KEY' });
    const serialised = JSON.stringify(client);
    expect(serialised).not.toContain('SECRET-TOKEN');
    expect(serialised).not.toContain('SECRET-KEY');
  });

  it('does not serialise credentials through a resource either', () => {
    const client = new HighClient({ accessToken: 'SECRET-TOKEN', apiKey: 'SECRET-KEY' });
    for (const resource of [
      client.auth, client.instruments, client.orders, client.portfolio, client.scrips, client.market,
    ]) {
      const serialised = JSON.stringify(resource);
      expect(serialised).not.toContain('SECRET-TOKEN');
      expect(serialised).not.toContain('SECRET-KEY');
    }
  });

  it('keeps the credentials usable despite being hidden', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: true }));
    const client = new HighClient({ baseUrl: server.baseUrl, accessToken: 'SECRET-TOKEN' });
    await client.market.status();
    expect(server.requests[0]!.headers.authorization).toBe('Bearer SECRET-TOKEN');
  });

  it('masks credentials in a util.inspect dump', async () => {
    const { inspect } = await import('node:util');
    const client = new HighClient({ accessToken: 'SECRET-TOKEN', apiKey: 'SECRET-KEY' });
    const dumped = inspect(client, { depth: 10 });
    expect(dumped).not.toContain('SECRET-TOKEN');
    expect(dumped).not.toContain('SECRET-KEY');
  });
});

// Finding 7 (Important): nothing pinned ENVIRONMENTS to the spec's servers.
describe('ENVIRONMENTS matches the pinned spec', () => {
  it('has one entry per server, with the host the spec declares', async () => {
    const { readFileSync } = await import('node:fs');
    const spec = JSON.parse(
      readFileSync(new URL('../generated/openapi.json', import.meta.url), 'utf8'),
    ) as { servers: Array<{ url: string; 'x-environment': string }> };

    const fromSpec = Object.fromEntries(
      spec.servers.map((s) => [s['x-environment'], new URL(s.url).origin]),
    );
    const fromCode = Object.fromEntries(
      Object.entries(ENVIRONMENTS).map(([name, hosts]) => [name, hosts.api]),
    );
    expect(fromCode).toEqual(fromSpec);
  });
});

// Finding 6 (Important): the facade widened a spec enum to `string`, so the
// type system could not catch a wrong value — and the SDK's own test passed one.
describe('expiries type parameter', () => {
  it('accepts the two values the spec declares', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: [] }));
    const client = new HighClient({ baseUrl: server.baseUrl, accessToken: 'tok' });
    await client.scrips.expiries('NIFTY 50', 'options');
    await client.scrips.expiries('NIFTY 50', 'futures');
    expect(server.requests[0]!.url).toBe('/v1/scrips/NIFTY%2050/options/expiries');
    expect(server.requests[1]!.url).toBe('/v1/scrips/NIFTY%2050/futures/expiries');

    // The type must reject anything else at compile time. If this stops being
    // an error, tsc fails on the unused @ts-expect-error and this test is the
    // one that tells you the facade widened the enum again.
    // @ts-expect-error 'OPT' is not one of the spec's values
    await client.scrips.expiries('NIFTY 50', 'OPT');
  });

  it('matches the enum the pinned spec declares', async () => {
    const { readFileSync } = await import('node:fs');
    const spec = JSON.parse(
      readFileSync(new URL('../generated/openapi.json', import.meta.url), 'utf8'),
    );
    const param = spec.paths['/scrips/{symbol}/{type}/expiries'].get.parameters
      .find((p: { name: string }) => p.name === 'type');
    expect(param.schema.enum).toEqual(['futures', 'options']);
  });
});
