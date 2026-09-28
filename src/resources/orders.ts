// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components, paths } from '../../generated/openapi.js';
import type { ResolvedConfig } from '../config.js';
import { request } from '../http.js';
import { pathOf } from '../paths.js';

type Schemas = components['schemas'];
type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

export type PlaceOrderRequest = Json<paths['/orders']['post']['requestBody']>;
export type ModifyOrderRequest = Json<paths['/orders']['patch']['requestBody']>;
export type OrderChargesRequest = Json<paths['/orders/charges']['post']['requestBody']>;
export type OrderMarginRequest = Json<paths['/orders/margin']['post']['requestBody']>;

export class OrdersResource {
  constructor(private readonly config: ResolvedConfig) {}

  /** Places a regular, bracket, cover or GTT order. Never retried. */
  place(body: PlaceOrderRequest, signal?: AbortSignal): Promise<Schemas['OrderPlacementResult']> {
    return request(this.config, { method: 'POST', path: '/orders', auth: 'bearer', body, signal });
  }

  /** Modifies a pending order. Never retried. */
  modify(body: ModifyOrderRequest, signal?: AbortSignal): Promise<Schemas['OrderPlacementResult']> {
    return request(this.config, { method: 'PATCH', path: '/orders', auth: 'bearer', body, signal });
  }

  /** One order, in the same shape as the order book. */
  get(orderId: string, signal?: AbortSignal): Promise<Schemas['OrderBook']> {
    return request(this.config, {
      method: 'GET', path: pathOf('/orders/{orderId}', { orderId }), auth: 'bearer', signal,
    });
  }

  /** Cancels a pending order. Never retried. */
  cancel(orderId: string, signal?: AbortSignal): Promise<Schemas['OrderCancelResult']> {
    return request(this.config, {
      method: 'DELETE', path: pathOf('/orders/{orderId}', { orderId }), auth: 'bearer', signal,
    });
  }

  /** Today's order book. */
  list(signal?: AbortSignal): Promise<Schemas['OrderBook']> {
    return request(this.config, { method: 'GET', path: '/orders/list', auth: 'bearer', signal });
  }

  /** Today's trade book. */
  trades(signal?: AbortSignal): Promise<Schemas['TradeBook']> {
    return request(this.config, { method: 'GET', path: '/orders/trades', auth: 'bearer', signal });
  }

  /** The fills of one order. */
  tradesFor(orderId: string, signal?: AbortSignal): Promise<Schemas['TradeBook']> {
    return request(this.config, {
      method: 'GET', path: pathOf('/orders/{orderId}/trades', { orderId }), auth: 'bearer', signal,
    });
  }

  /** Estimated brokerage and statutory charges for one order. */
  charges(body: OrderChargesRequest, signal?: AbortSignal): Promise<Schemas['OrderCharges']> {
    return request(this.config, { method: 'POST', path: '/orders/charges', auth: 'bearer', body, signal });
  }

  /** Margin required for a basket of orders. */
  margin(body: OrderMarginRequest, signal?: AbortSignal): Promise<Schemas['OrderMargin']> {
    return request(this.config, { method: 'POST', path: '/orders/margin', auth: 'bearer', body, signal });
  }
}
