// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Streams live quotes, one depth book, and one index. Run with:
 *   HIGH_ACCESS_TOKEN=... node examples/datafeed.mjs
 *
 * Production only — there is no sandbox datafeed, so this always talks to
 * openapi-feed.high.live regardless of HIGH_ENVIRONMENT.
 */
import { HighFeed, HighFeedAuthError } from '../dist/index.js';

const feed = new HighFeed({ logLevel: process.env.HIGH_LOG_LEVEL ?? 'silent' });

feed.on('reconnecting', ({ attempt, delayMs }) => {
  console.log(`reconnecting (attempt ${attempt}, in ${delayMs}ms)…`);
});
feed.on('error', (error) => {
  console.error('feed error:', error.message);
});

try {
  await feed.connect();

  await feed.subscribeQuotes(['NSE@2885', 'NSE@11536']); // RELIANCE, TCS
  await feed.subscribeDepth(['NSE@2885']);
  await feed.subscribeIndices(['NSE@26000']); // Nifty 50

  feed.on('quote', ({ scripKey, data, changedFields }) => {
    console.log(`[quote] ${scripKey} ltp=${data.lastTradedPrice} changed=${[...changedFields].join(',')}`);
  });
  feed.on('depth', ({ scripKey, data }) => {
    console.log(`[depth:${data.levels}] ${scripKey} bestBid=${data.bids[0]?.price} bestAsk=${data.asks[0]?.price}`);
  });
  feed.on('index', ({ scripKey, data }) => {
    console.log(`[index] ${scripKey} ${data.indexName}=${data.indexValue}`);
  });

  // Stop after a minute so the example has a natural end.
  await new Promise((resolve) => setTimeout(resolve, 60_000));
  await feed.close();
} catch (error) {
  if (error instanceof HighFeedAuthError) {
    console.error(`auth refused (${error.reason}, stCode ${error.stCode}): ${error.msg}`);
    process.exit(1);
  }
  throw error;
}
