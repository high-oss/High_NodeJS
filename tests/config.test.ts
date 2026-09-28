// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { buildUrl, ENVIRONMENTS, resolveConfig } from '../src/config.js';

describe('resolveConfig', () => {
  it('defaults to production v1', () => {
    const config = resolveConfig({}, {});
    expect(config.baseUrl).toBe('https://openapi.high.live');
    expect(config.versionPath).toBe('v1');
    expect(config.timeoutMs).toBe(30_000);
    expect(config.maxRetries).toBe(2);
  });

  it('maps the sandbox environment to its host', () => {
    expect(resolveConfig({ environment: 'sandbox' }, {}).baseUrl).toBe(ENVIRONMENTS.sandbox.api);
  });

  // Reserved for the datafeed socket, which lands in its own plan. Resolving it
  // here means the feed reuses this config instead of introducing a second one.
  it('resolves a websocket host alongside the API host', () => {
    expect(resolveConfig({}, {}).wsBaseUrl).toBe(ENVIRONMENTS.production.ws);
    expect(resolveConfig({ environment: 'sandbox' }, {}).wsBaseUrl).toBe(ENVIRONMENTS.sandbox.ws);
  });

  it('lets wsBaseUrl be overridden without touching baseUrl', () => {
    const config = resolveConfig({ wsBaseUrl: 'ws://127.0.0.1:9001' }, {});
    expect(config.wsBaseUrl).toBe('ws://127.0.0.1:9001');
    expect(config.baseUrl).toBe(ENVIRONMENTS.production.api);
  });

  it('lets an explicit baseUrl win over the environment', () => {
    const config = resolveConfig({ environment: 'sandbox', baseUrl: 'http://localhost:8080' }, {});
    expect(config.baseUrl).toBe('http://localhost:8080');
  });

  it('reads environment and credentials from env vars when not passed', () => {
    const config = resolveConfig({}, {
      HIGH_ENVIRONMENT: 'sandbox',
      HIGH_API_KEY: 'k',
      HIGH_ACCESS_TOKEN: 't',
    });
    expect(config.baseUrl).toBe(ENVIRONMENTS.sandbox.api);
    expect(config.apiKey).toBe('k');
    expect(config.accessToken).toBe('t');
  });

  it('prefers explicit options over env vars', () => {
    const config = resolveConfig({ apiKey: 'explicit' }, { HIGH_API_KEY: 'from-env' });
    expect(config.apiKey).toBe('explicit');
  });

  it('rejects an unknown environment at construction, naming the valid values', () => {
    expect(() => resolveConfig({ environment: 'staging' as never }, {}))
      .toThrow(/staging.*production.*sandbox/s);
  });

  it('rejects an unknown HIGH_ENVIRONMENT value too', () => {
    expect(() => resolveConfig({}, { HIGH_ENVIRONMENT: 'prod' })).toThrow(/prod/);
  });
});

describe('buildUrl', () => {
  it('joins base, version and path', () => {
    const config = resolveConfig({}, {});
    expect(buildUrl(config, '/orders/list')).toBe('https://openapi.high.live/v1/orders/list');
  });

  // Review Focus 1: a user pasting a URL out of a browser brings a trailing slash.
  it('tolerates stray slashes on every part', () => {
    const config = resolveConfig({ baseUrl: 'https://h.example/', versionPath: '/v2/' }, {});
    expect(buildUrl(config, '/orders')).toBe('https://h.example/v2/orders');
    expect(buildUrl(config, 'orders')).toBe('https://h.example/v2/orders');
  });

  it('supports a base URL that already carries a path prefix', () => {
    const config = resolveConfig({ baseUrl: 'https://h.example/api/' }, {});
    expect(buildUrl(config, '/orders')).toBe('https://h.example/api/v1/orders');
  });

  it('allows an empty versionPath for an unversioned host', () => {
    const config = resolveConfig({ versionPath: '' }, {});
    expect(buildUrl(config, '/orders')).toBe('https://openapi.high.live/orders');
  });
});
