// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components, paths } from '../../generated/openapi.js';
import type { ResolvedConfig } from '../config.js';
import { request } from '../http.js';

type Schemas = components['schemas'];
type Json<T> = T extends { content: { 'application/json': infer B } } ? B : never;

export type ConvertPositionRequest = Json<paths['/portfolio/positions/convert']['patch']['requestBody']>;
export type ExitPositionRequest = Json<paths['/portfolio/positions/exit']['delete']['requestBody']>;

export class PortfolioResource {
  constructor(private readonly config: ResolvedConfig) {}

  /** Open intraday and carry-forward positions with their P&L snapshot. */
  positions(signal?: AbortSignal): Promise<Schemas['Positions']> {
    return request(this.config, { method: 'GET', path: '/portfolio/positions', auth: 'bearer', signal });
  }

  /** Demat holdings with their investment snapshot. */
  holdings(signal?: AbortSignal): Promise<Schemas['Holdings']> {
    return request(this.config, { method: 'GET', path: '/portfolio/holdings', auth: 'bearer', signal });
  }

  /** Cash, margin and charge balances. */
  funds(signal?: AbortSignal): Promise<Schemas['Funds']> {
    return request(this.config, { method: 'GET', path: '/portfolio/funds', auth: 'bearer', signal });
  }

  /** Converts a position between product types. Never retried. */
  convertPosition(
    body: ConvertPositionRequest,
    signal?: AbortSignal,
  ): Promise<Schemas['PositionConvertResult']> {
    return request(this.config, {
      method: 'PATCH', path: '/portfolio/positions/convert', auth: 'bearer', body, signal,
    });
  }

  /** Squares off every open position. Never retried. */
  exitAllPositions(signal?: AbortSignal): Promise<Schemas['PositionExitAllResult']> {
    return request(this.config, {
      method: 'DELETE', path: '/portfolio/positions/exit/all', auth: 'bearer', signal,
    });
  }

  /** Squares off one position. The API expects a body on this DELETE. Never retried. */
  exitPosition(
    body: ExitPositionRequest,
    signal?: AbortSignal,
  ): Promise<Schemas['PositionExitResult']> {
    return request(this.config, {
      method: 'DELETE', path: '/portfolio/positions/exit', auth: 'bearer', body, signal,
    });
  }
}
