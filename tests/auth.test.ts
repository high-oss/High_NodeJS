// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighClient } from '../src/client.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const clientFor = (s: TestServer) =>
  new HighClient({ baseUrl: s.baseUrl, apiKey: 'key', accessToken: 'tok' });

describe('auth resource', () => {
  it('generateAccessToken sends clientId and tOtp as query parameters with the api key', async () => {
    server = await startServer((_req, res) =>
      json(res, 200, { requestId: 'r', data: { accessToken: 'jwt', expiresAt: '2026-09-28T06:30:56.123Z' } }));
    const token = await clientFor(server).auth.generateAccessToken({ clientId: 'C1', tOtp: '123456' });
    expect(token.accessToken).toBe('jwt');
    expect(server.requests[0]!.url).toContain('clientId=C1');
    expect(server.requests[0]!.url).toContain('tOtp=123456');
    expect(server.requests[0]!.headers['x-api-key']).toBe('key');
    expect(server.requests[0]!.headers.authorization).toBeUndefined();
  });

  it('exposes only generateAccessToken — no consent flow, no introspection', async () => {
    server = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: {} }));
    const auth = clientFor(server).auth as unknown as Record<string, unknown>;
    expect(typeof auth.generateAccessToken).toBe('function');
    for (const name of ['generateConsent', 'consumeConsent', 'validateToken', 'login', 'loginUrl']) {
      expect(auth[name], `auth.${name} must not exist`).toBeUndefined();
    }
  });
});

describe('market resource', () => {
  it('status returns the exchange status map', async () => {
    server = await startServer((_req, res) => json(res, 200, {
      requestId: 'r',
      data: { isHoliday: false, date: '2026-09-25', exchangeStatus: { NSE: { status: 'OPEN', timeRemainingInSeconds: 1 } } },
    }));
    const status = await clientFor(server).market.status();
    expect(status.exchangeStatus.NSE?.status).toBe('OPEN');
    expect(server.requests[0]!.url).toBe('/v1/market/status');
  });
});

describe('client', () => {
  it('honours an explicit versionPath', async () => {
    server = await startServer((_req, res) => json(res, 200, {
      requestId: 'r',
      data: { isHoliday: false, date: '2026-09-25', exchangeStatus: {} },
    }));
    const client = new HighClient({ baseUrl: server.baseUrl, versionPath: 'v2', accessToken: 'tok' });
    await client.market.status();
    expect(server.requests[0]!.url).toBe('/v2/market/status');
  });
});
