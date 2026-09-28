// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighClient } from '../src/client.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const clientFor = (s: TestServer) => new HighClient({ baseUrl: s.baseUrl, accessToken: 'tok' });
const ok = (data: unknown) => ({ requestId: 'r', data });

describe('portfolio resource', () => {
  it('positions returns the account snapshot and the list', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      totalStocks: 1,
      snapshot: { bookedPL: 100, unrealisedPL: 123, totalPL: 223, bookedPLPercent: 0.71, unrealisedPLPercent: 0.88, totalPLPercent: 0.8 },
      positions: [], scrips: {},
    })));
    const positions = await clientFor(server).portfolio.positions();
    expect(positions.snapshot.totalPL).toBe(223);
    expect(server.requests[0]!.url).toBe('/v1/portfolio/positions');
  });

  it('holdings uses the investment snapshot, not the P&L one', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      totalStocks: 1,
      snapshot: { investment: 13000, currentValue: 14123, previousDayValue: 14058, totalPL: 1123, dayPL: 65, totalPLPercent: 8.64, dayPLPercent: 0.46 },
      holdings: [], scrips: {},
    })));
    const holdings = await clientFor(server).portfolio.holdings();
    expect(holdings.snapshot.investment).toBe(13000);
    expect(server.requests[0]!.url).toBe('/v1/portfolio/holdings');
  });

  it('funds returns balances', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      availableBalance: 125000.5, ledgerBalance: 150000, todaysBalance: 155000.5,
      marginUtilized: 30000, marginAgainstAssets: 50000, todaysPayIn: 10000, todaysPayout: 5000,
      mtfFunds: { mtfCash: 0, mtfFunded: 0, totalMTFFunding: 0 },
      charges: { delayedPaymentCharges: 0, dpCharges: 0, totalCharges: 0 },
      unsettledFutureAmount: 0,
    })));
    const funds = await clientFor(server).portfolio.funds();
    expect(funds.availableBalance).toBe(125000.5);
  });

  it('convertPosition PATCHes the convert endpoint', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      tradingSymbol: 'RELIANCE-EQ', exchangeSegment: 'NSE', scripCode: '2885',
      quantity: 50, isSubmitted: true,
    })));
    await clientFor(server).portfolio.convertPosition({
      tradingSymbol: 'RELIANCE-EQ', quantity: 50, tradeSide: 'B',
      sourceProductType: 'INTRADAY', targetProductType: 'DELIVERY',
    });
    expect(server.requests[0]!.method).toBe('PATCH');
    expect(server.requests[0]!.url).toBe('/v1/portfolio/positions/convert');
  });

  it('exitAllPositions DELETEs with no body', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      totalCount: 0, successCount: 0, failureCount: 0, positions: [],
    })));
    await clientFor(server).portfolio.exitAllPositions();
    expect(server.requests[0]!.method).toBe('DELETE');
    expect(server.requests[0]!.url).toBe('/v1/portfolio/positions/exit/all');
    expect(server.requests[0]!.body).toBe('');
  });

  // The API really does expect a body on this DELETE.
  it('exitPosition DELETEs WITH a body', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      tradingSymbol: 'RELIANCE-EQ', exchangeSegment: 'NSE', scripCode: '2885',
      quantity: 50, flavor: 'REGULAR', isSubmitted: true,
    })));
    await clientFor(server).portfolio.exitPosition({
      tradingSymbol: 'RELIANCE-EQ', productType: 'INTRADAY', flavor: 'REGULAR',
      tradeSide: 'S', quantity: 50,
    });
    expect(server.requests[0]!.method).toBe('DELETE');
    expect(server.requests[0]!.url).toBe('/v1/portfolio/positions/exit');
    expect(JSON.parse(server.requests[0]!.body)).toMatchObject({ tradingSymbol: 'RELIANCE-EQ' });
  });

  it('never retries a square-off, even on 503', async () => {
    server = await startServer((_req, res) => json(res, 503, { code: 'SERVICE_UNAVAILABLE' }));
    await expect(clientFor(server).portfolio.exitAllPositions()).rejects.toThrow();
    expect(server.requests).toHaveLength(1);
  });
});
