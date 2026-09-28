// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { type HighClientOptions, resolveConfig, type ResolvedConfig } from './config.js';
import { AuthResource } from './resources/auth.js';
import { MarketResource } from './resources/market.js';
import { OrdersResource } from './resources/orders.js';

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
  readonly market: MarketResource;
  readonly orders: OrdersResource;

  constructor(options: HighClientOptions = {}) {
    this.config = resolveConfig(options);
    this.auth = new AuthResource(this.config);
    this.market = new MarketResource(this.config);
    this.orders = new OrdersResource(this.config);
  }
}
