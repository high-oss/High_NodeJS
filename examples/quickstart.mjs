// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Reads the portfolio and the market session. Run with:
 *   HIGH_ENVIRONMENT=sandbox HIGH_ACCESS_TOKEN=... node examples/quickstart.mjs
 */
import { HighApiError, HighClient } from '../dist/index.js';

const high = new HighClient({ logLevel: process.env.HIGH_LOG_LEVEL ?? 'silent' });

try {
  const [funds, holdings, status] = await Promise.all([
    high.portfolio.funds(),
    high.portfolio.holdings(),
    high.market.status(),
  ]);

  console.log('Available balance:', funds.availableBalance);
  console.log('Holdings:', holdings.totalStocks, 'worth', holdings.snapshot.currentValue);
  console.log('NSE:', status.exchangeStatus.NSE?.status);
} catch (error) {
  if (error instanceof HighApiError) {
    console.error(`[${error.status}] ${error.code ?? 'no code'}: ${error.message}`);
    console.error('requestId:', error.requestId);
    process.exit(1);
  }
  throw error;
}
