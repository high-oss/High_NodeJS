// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighClient } from '../src/client.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const clientFor = (s: TestServer) => new HighClient({ baseUrl: s.baseUrl, accessToken: 'tok' });
const ok = (data: unknown) => ({ requestId: 'r', data });

describe('scrips resource', () => {
  it('quotes returns a map keyed by trading symbol, not a list', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      'RELIANCE-EQ': { scrip: 'NSE@2885', LTP: 1412.3, prevClose: 1405.8, change: 6.5, changePer: 0.46 },
    })));
    const quotes = await clientFor(server).scrips.quotes({ symbols: ['RELIANCE-EQ'] });
    expect(Array.isArray(quotes)).toBe(false);
    expect(quotes['RELIANCE-EQ']?.LTP).toBe(1412.3);
    expect(server.requests[0]!.url).toBe('/v1/scrips/quotes');
  });

  it('ohlc returns the same map shape with an ohlcv block', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      'RELIANCE-EQ': {
        scrip: 'NSE@2885', LTP: 1412.3, prevClose: 1405.8, change: 6.5, changePer: 0.46,
        ohlcv: { open: 1407, high: 1418.6, low: 1403.2, close: 1412.3, volume: 6843210 },
      },
    })));
    const ohlc = await clientFor(server).scrips.ohlc({ symbols: ['RELIANCE-EQ'] });
    expect(ohlc['RELIANCE-EQ']?.ohlcv?.volume).toBe(6843210);
  });

  it('depth encodes the symbol into the path', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      tradingSymbol: 'M&M-EQ', bids: [], asks: [],
      totalBidQuantity: 0, totalAskQuantity: 0, totalAskPercentage: 0, totalBidsPercentage: 0,
    })));
    await clientFor(server).scrips.depth('M&M-EQ');
    expect(server.requests[0]!.url).toBe('/v1/scrips/M%26M-EQ/depth');
  });

  it('expiries returns an array and encodes both parameters', async () => {
    server = await startServer((_req, res) => json(res, 200, ok([{ expiry: '2026-09-29', type: 'M' }])));
    const expiries = await clientFor(server).scrips.expiries('NIFTY 50', 'OPT');
    expect(expiries).toHaveLength(1);
    expect(expiries[0]?.type).toBe('M');
    expect(server.requests[0]!.url).toBe('/v1/scrips/NIFTY%2050/OPT/expiries');
  });

  it('futureData returns an array of scrips', async () => {
    server = await startServer((_req, res) => json(res, 200, ok([])));
    const futures = await clientFor(server).scrips.futureData('RELIANCE-EQ');
    expect(Array.isArray(futures)).toBe(true);
    expect(server.requests[0]!.url).toBe('/v1/scrips/RELIANCE-EQ/future-data');
  });

  it('historical returns parallel columns of equal length, not row objects', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      tradingSymbol: 'NSE@2885', interval: '1D',
      timestamp: [1789929000, 1790015400], open: [1398.5, 1402], high: [1406.2, 1409.8],
      low: [1394.1, 1399.3], close: [1401.7, 1407.4], volume: [7215430, 6532180],
    })));
    const candles = await clientFor(server).scrips.historical({
      tradingSymbol: 'RELIANCE-EQ', interval: '1D', fromTime: 1789929000, toTime: 1790330400,
    });
    expect(candles.timestamp).toHaveLength(2);
    expect(candles.close).toHaveLength(candles.timestamp.length);
    expect(Array.isArray(candles.open)).toBe(true);
  });

  it('optionChain returns rows with call and put legs', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      baseStockInfo: {
        tradingSymbol: 'RELIANCE-EQ', scripCode: 2885, exchange: 'NSE', segment: 'ES',
        scripKey: 'NSE@2885', symbol: 'RELIANCE', scripName: 'Reliance', marketLot: 1, priceTick: 10,
      },
      optionChain: [{ strikePrice: 1400, call: {}, put: {} }],
      marketLot: 500, maxOrderLots: 36,
    })));
    const chain = await clientFor(server).scrips.optionChain({
      tradingSymbol: 'RELIANCE-EQ', expiry: '2026-09-29',
    });
    expect(chain.optionChain[0]?.strikePrice).toBe(1400);
  });

  it('retries a quotes failure? No — quotes is a POST', async () => {
    server = await startServer((_req, res) => json(res, 503, { code: 'SERVICE_UNAVAILABLE' }));
    await expect(clientFor(server).scrips.quotes({ symbols: ['RELIANCE-EQ'] })).rejects.toThrow();
    expect(server.requests).toHaveLength(1);
  });
});
