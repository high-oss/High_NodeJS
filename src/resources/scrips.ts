// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components, paths } from '../../generated/openapi.js';
import type { ResolvedConfig } from '../config.js';
import { request } from '../http.js';
import { pathOf } from '../paths.js';

type Schemas = components['schemas'];
type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

export type QuotesRequest = Json<paths['/scrips/quotes']['post']['requestBody']>;
export type OhlcRequest = Json<paths['/scrips/ohlc']['post']['requestBody']>;
export type HistoricalRequest = Json<paths['/scrips/historical']['post']['requestBody']>;
export type OptionChainRequest = Json<paths['/scrips/option-chain']['post']['requestBody']>;

export class ScripsResource {
  constructor(private readonly config: ResolvedConfig) {}

  /** Last traded price and session change, keyed by trading symbol. */
  quotes(body: QuotesRequest, signal?: AbortSignal): Promise<Schemas['QuoteMap']> {
    return request(this.config, { method: 'POST', path: '/scrips/quotes', auth: 'bearer', body, signal });
  }

  /** Quotes plus the session OHLCV block, keyed by trading symbol. */
  ohlc(body: OhlcRequest, signal?: AbortSignal): Promise<Schemas['QuoteMap']> {
    return request(this.config, { method: 'POST', path: '/scrips/ohlc', auth: 'bearer', body, signal });
  }

  /** Five levels of bids and asks. */
  depth(symbol: string, signal?: AbortSignal): Promise<Schemas['MarketDepth']> {
    return request(this.config, {
      method: 'GET', path: pathOf('/scrips/{symbol}/depth', { symbol }), auth: 'bearer', signal,
    });
  }

  /** Available expiries for a derivative underlying. */
  expiries(symbol: string, type: string, signal?: AbortSignal): Promise<Schemas['Expiry'][]> {
    return request(this.config, {
      method: 'GET', path: pathOf('/scrips/{symbol}/{type}/expiries', { symbol, type }),
      auth: 'bearer', signal,
    });
  }

  /** The futures contracts on an underlying. */
  futureData(symbol: string, signal?: AbortSignal): Promise<Schemas['ScripInfo'][]> {
    return request(this.config, {
      method: 'GET', path: pathOf('/scrips/{symbol}/future-data', { symbol }), auth: 'bearer', signal,
    });
  }

  /**
   * Historical candles, returned columnar: every array has the same length and
   * index i across them describes one candle.
   */
  historical(body: HistoricalRequest, signal?: AbortSignal): Promise<Schemas['HistoricalCandles']> {
    return request(this.config, { method: 'POST', path: '/scrips/historical', auth: 'bearer', body, signal });
  }

  /** The option chain for one underlying and expiry. */
  optionChain(body: OptionChainRequest, signal?: AbortSignal): Promise<Schemas['OptionChain']> {
    return request(this.config, { method: 'POST', path: '/scrips/option-chain', auth: 'bearer', body, signal });
  }
}
