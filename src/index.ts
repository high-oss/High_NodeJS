// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

export { HighClient } from './client.js';
export { ENVIRONMENTS, resolveConfig } from './config.js';
export type { Environment, HighClientOptions, ResolvedConfig } from './config.js';
export { ERROR_CODES, HighApiError } from './errors.js';
export type { ErrorCode } from './errors.js';
export { createLogger, LOG_LEVELS } from './logger.js';
export type { Logger, LogLevel, LogSink } from './logger.js';

export { AuthResource } from './resources/auth.js';
export { MarketResource } from './resources/market.js';
export { OrdersResource } from './resources/orders.js';
export { PortfolioResource } from './resources/portfolio.js';
export { ScripsResource } from './resources/scrips.js';

export type {
  ModifyOrderRequest, OrderChargesRequest, OrderMarginRequest, PlaceOrderRequest,
} from './resources/orders.js';
export type { ConvertPositionRequest, ExitPositionRequest } from './resources/portfolio.js';
export type {
  HistoricalRequest, OhlcRequest, OptionChainRequest, QuotesRequest,
} from './resources/scrips.js';

export type { components, paths } from '../generated/openapi.js';
