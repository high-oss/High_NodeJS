// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Places a limit order and reads it back. Requires a registered static IP.
 *
 *   HIGH_ENVIRONMENT=sandbox HIGH_ACCESS_TOKEN=... node examples/place-order.mjs
 *
 * Nothing here is retried: a retried order placement would be a duplicate order.
 */
import { HighApiError, HighClient } from '../dist/index.js';

const high = new HighClient();

try {
  const charges = await high.orders.charges({
    tradingSymbol: 'RELIANCE-EQ',
    quantity: 1,
    price: 1400,
    productType: 'DELIVERY',
    tradeSide: 'B',
  });
  console.log('Estimated charges:', charges.charges.totalBuyCharges);

  const placed = await high.orders.place({
    tradeSide: 'B',
    tradingSymbol: 'RELIANCE-EQ',
    productType: 'DELIVERY',
    flavor: 'REGULAR',
    orderType: 'LIMIT',
    validity: 'DAY',
    quantity: 1,
    price: 1400,
    isAMO: false,
  });

  console.log('Order id:', placed.orderId);

  const book = await high.orders.get(placed.orderId);
  console.log('Status:', book.orders[0]?.orderStatus);
} catch (error) {
  if (error instanceof HighApiError) {
    console.error(`[${error.status}] ${error.code ?? 'no code'}: ${error.message}`);
    if (error.requestId) console.error('requestId:', error.requestId);
    process.exit(1);
  }
  throw error;
}
