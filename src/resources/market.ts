// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components } from '../../generated/openapi.js';
import type { ResolvedConfig } from '../config.js';
import { request } from '../http.js';

export class MarketResource {
  constructor(private readonly config: ResolvedConfig) {}

  /** Session state per exchange for today. */
  status(signal?: AbortSignal): Promise<components['schemas']['MarketStatus']> {
    return request(this.config, { method: 'GET', path: '/market/status', auth: 'bearer', signal });
  }
}
