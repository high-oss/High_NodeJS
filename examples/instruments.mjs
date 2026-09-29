// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Lists instruments. No credentials needed — this is public data. Run with:
 *   node examples/instruments.mjs
 */
import { HighApiError, HighClient } from '../dist/index.js';

const high = new HighClient();

try {
  let count = 0;
  for await (const row of high.instruments.stream('equity')) {
    if (count < 5) console.log(row.highTradingSymbol, row.symbol, row.lotSize);
    count += 1;
  }
  console.log(`... ${count} equity instruments total`);

  const etfs = await high.instruments.list('etfs');
  console.log(`${etfs.length} ETFs, first:`, etfs[0]?.name);
} catch (error) {
  if (error instanceof HighApiError) {
    console.error(`[${error.status}] ${error.code ?? 'no code'}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
