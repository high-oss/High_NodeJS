// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';
import { HighClient } from '../src/client.js';
import { json, startServer, type TestServer } from './server.js';

let server: TestServer;
afterEach(async () => { await server?.close(); });

const clientFor = (s: TestServer) =>
  new HighClient({ baseUrl: s.baseUrl, accessToken: 'tok' });

const ok = (data: unknown) => ({ requestId: 'r', data });

describe('orders resource', () => {
  it('place POSTs the body to /orders', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orderId: '1', error: '' })));
    const result = await clientFor(server).orders.place({
      tradeSide: 'B', tradingSymbol: 'RELIANCE-EQ', productType: 'DELIVERY',
      flavor: 'REGULAR', orderType: 'LIMIT', validity: 'DAY', quantity: 10,
      price: 1410, isAMO: false,
    });
    expect(result.orderId).toBe('1');
    expect(server.requests[0]!.method).toBe('POST');
    expect(server.requests[0]!.url).toBe('/v1/orders');
    expect(JSON.parse(server.requests[0]!.body)).toMatchObject({ tradingSymbol: 'RELIANCE-EQ' });
  });

  it('modify PATCHes /orders', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orderId: '1', error: '' })));
    await clientFor(server).orders.modify({
      orderId: '2609250000123502',
      tradeSide: 'B', tradingSymbol: 'RELIANCE-EQ', productType: 'DELIVERY',
      flavor: 'REGULAR', orderType: 'LIMIT', validity: 'DAY', quantity: 5,
      price: 1400, isAMO: false,
    });
    expect(server.requests[0]!.method).toBe('PATCH');
    expect(server.requests[0]!.url).toBe('/v1/orders');
  });

  it('cancel DELETEs the order by id', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orderId: '1', error: '' })));
    await clientFor(server).orders.cancel('2609250000123502');
    expect(server.requests[0]!.method).toBe('DELETE');
    expect(server.requests[0]!.url).toBe('/v1/orders/2609250000123502');
  });

  it('get fetches one order and returns the book shape', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orders: [], scrips: {} })));
    const book = await clientFor(server).orders.get('2609250000123456');
    expect(book.orders).toEqual([]);
    expect(server.requests[0]!.url).toBe('/v1/orders/2609250000123456');
  });

  it('list fetches the order book', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orders: [], scrips: {} })));
    await clientFor(server).orders.list();
    expect(server.requests[0]!.url).toBe('/v1/orders/list');
  });

  it('trades fetches the trade book', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ trades: [], scrips: {} })));
    await clientFor(server).orders.trades();
    expect(server.requests[0]!.url).toBe('/v1/orders/trades');
  });

  it('tradesFor fetches the trades of one order', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ trades: [], scrips: {} })));
    await clientFor(server).orders.tradesFor('2609250000123456');
    expect(server.requests[0]!.url).toBe('/v1/orders/2609250000123456/trades');
  });

  it('charges POSTs an estimate request', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({
      quantity: 10, price: 1410, productType: 'DELIVERY', tradeSide: 'B',
      tradedValue: 14100, charges: { brokerage: 5 },
    })));
    const charges = await clientFor(server).orders.charges({
      tradingSymbol: 'RELIANCE-EQ', quantity: 10, price: 1410,
      productType: 'DELIVERY', tradeSide: 'B',
    });
    expect(charges.tradedValue).toBe(14100);
    expect(server.requests[0]!.method).toBe('POST');
    expect(server.requests[0]!.url).toBe('/v1/orders/charges');
  });

  it('margin POSTs an array of orders', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ margins: [], spanSummary: { totalMargin: 0 } })));
    await clientFor(server).orders.margin([
      { tradingSymbol: 'RELIANCE-EQ', quantity: 10, price: 1410, productType: 'DELIVERY', tradeSide: 'B' },
    ]);
    expect(server.requests[0]!.url).toBe('/v1/orders/margin');
    expect(Array.isArray(JSON.parse(server.requests[0]!.body))).toBe(true);
  });

  it('encodes an order id that would otherwise alter the path', async () => {
    server = await startServer((_req, res) => json(res, 200, ok({ orderId: 'x', error: '' })));
    await clientFor(server).orders.cancel('a/b');
    expect(server.requests[0]!.url).toBe('/v1/orders/a%2Fb');
  });
});
