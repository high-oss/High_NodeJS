// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

export { HighClient } from './client.js';
export { DEFAULT_INSTRUMENT_HOSTS, ENVIRONMENTS, resolveConfig } from './config.js';
export type { Environment, HighClientOptions, ResolvedConfig } from './config.js';
export { ERROR_CODES, HighApiError } from './errors.js';
export type { ErrorCode } from './errors.js';
export { createLogger, LOG_LEVELS, redactBody, redactUrl } from './logger.js';
export type { Logger, LogLevel, LogSink } from './logger.js';

export { AuthResource } from './resources/auth.js';
export { InstrumentsResource } from './resources/instruments.js';
export { MarketResource } from './resources/market.js';
export { OrdersResource } from './resources/orders.js';
export { PortfolioResource } from './resources/portfolio.js';
export { ScripsResource } from './resources/scrips.js';

export type {
  InstrumentCategory, InstrumentRow, InstrumentsRequestOptions,
} from './resources/instruments.js';
export type {
  ModifyOrderRequest, OrderChargesRequest, OrderMarginRequest, PlaceOrderRequest,
} from './resources/orders.js';
export type { ConvertPositionRequest, ExitPositionRequest } from './resources/portfolio.js';
export type {
  ExpiryType, HistoricalRequest, OhlcRequest, OptionChainRequest, QuotesRequest,
} from './resources/scrips.js';

export { HighFeed } from './feed/feed.js';
export type { HighFeedEventMap } from './feed/feed.js';
export { HighFeedAuthError, HighFeedError } from './feed/errors.js';
export type { FeedAuthFailureReason } from './feed/errors.js';
export type {
  Depth, DepthLevel, DepthTickEvent, FeedKind, FeedTickEvent,
  IndexTick, IndexTickEvent, Quote, QuoteTickEvent,
} from './feed/models.js';

export type { components, paths } from '../generated/openapi.js';
