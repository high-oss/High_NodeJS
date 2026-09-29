// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { type HighClientOptions, resolveConfig, type ResolvedConfig } from './config.js';
import { AuthResource } from './resources/auth.js';
import { InstrumentsResource } from './resources/instruments.js';
import { MarketResource } from './resources/market.js';
import { OrdersResource } from './resources/orders.js';
import { PortfolioResource } from './resources/portfolio.js';
import { ScripsResource } from './resources/scrips.js';

/**
 * The HIGH Open API client.
 *
 * ```ts
 * const high = new HighClient({ environment: 'sandbox', apiKey, accessToken });
 * const funds = await high.portfolio.funds();
 * ```
 */
export class HighClient {
  /** Where requests go and what they carry. Settled once, at construction. */
  readonly config: ResolvedConfig;

  readonly auth: AuthResource;
  readonly instruments: InstrumentsResource;
  readonly market: MarketResource;
  readonly orders: OrdersResource;
  readonly portfolio: PortfolioResource;
  readonly scrips: ScripsResource;

  constructor(options: HighClientOptions = {}) {
    this.config = resolveConfig(options);
    this.auth = new AuthResource(this.config);
    this.instruments = new InstrumentsResource(this.config);
    this.market = new MarketResource(this.config);
    this.orders = new OrdersResource(this.config);
    this.portfolio = new PortfolioResource(this.config);
    this.scrips = new ScripsResource(this.config);
  }
}
