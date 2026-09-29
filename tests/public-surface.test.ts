// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import * as sdk from '../src/index.js';

describe('public surface', () => {
  it('exports the client, the error type and the catalogues', () => {
    expect(typeof sdk.HighClient).toBe('function');
    expect(typeof sdk.HighApiError).toBe('function');
    expect(Array.isArray(sdk.ERROR_CODES)).toBe(true);
    expect(Array.isArray(sdk.LOG_LEVELS)).toBe(true);
    expect(sdk.ENVIRONMENTS.production.api).toBe('https://openapi.high.live');
    expect(sdk.ENVIRONMENTS.sandbox.api).toBe('https://sandbox.high.live');
  });

  it('wraps neither the browser login page, the consent flow, nor introspection', () => {
    const client = new sdk.HighClient({ accessToken: 'tok' });
    const auth = client.auth as unknown as Record<string, unknown>;
    for (const name of ['login', 'loginUrl', 'renderLogin', 'generateConsent', 'consumeConsent', 'validateToken']) {
      expect(auth[name], `auth.${name} must not exist`).toBeUndefined();
    }
  });

  it('exposes all six resources on a constructed client', () => {
    const client = new sdk.HighClient({ accessToken: 'tok' });
    for (const name of ['auth', 'instruments', 'orders', 'portfolio', 'scrips', 'market'] as const) {
      expect(client[name], `client.${name} is missing`).toBeDefined();
    }
  });

  it('exposes every operation the SDK covers as a method', () => {
    const client = new sdk.HighClient({ accessToken: 'tok' });
    const expected: Record<string, string[]> = {
      auth: ['generateAccessToken'],
      instruments: ['stream', 'list'],
      orders: ['place', 'modify', 'get', 'cancel', 'list', 'trades', 'tradesFor', 'charges', 'margin'],
      portfolio: ['positions', 'holdings', 'funds', 'convertPosition', 'exitAllPositions', 'exitPosition'],
      scrips: ['quotes', 'ohlc', 'depth', 'expiries', 'futureData', 'historical', 'optionChain'],
      market: ['status'],
    };
    let count = 0;
    for (const [resource, methods] of Object.entries(expected)) {
      for (const method of methods) {
        const target = (client as unknown as Record<string, Record<string, unknown>>)[resource]!;
        expect(typeof target[method], `${resource}.${method}`).toBe('function');
        count += 1;
      }
    }
    // The spec has 28 operations; the SDK covers 25 of them — login, the two
    // consent operations and token introspection are deliberately excluded.
    // The instrument list operation is exposed as two methods (stream, list),
    // so the method count (26) is one higher than the operation count (25).
    expect(count).toBe(26);
  });

  it('ships no runtime dependencies', async () => {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(pkg.name).toBe('@high/openapi');
  });
});
