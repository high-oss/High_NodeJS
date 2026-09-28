// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components } from '../../generated/openapi.js';
import type { ResolvedConfig } from '../config.js';
import { request } from '../http.js';

type Schemas = components['schemas'];

/**
 * TOTP authentication.
 *
 * The redirect consent flow (`/auth/generate-consent`, `/auth/login`,
 * `/auth/consume-consent`) is deliberately not wrapped: it is built around a
 * browser page only a human can complete. Token introspection
 * (`/auth/validate-token`) is not wrapped either — a caller learns a token is
 * invalid from the next call's 401. See the README.
 */
export class AuthResource {
  constructor(private readonly config: ResolvedConfig) {}

  /** Exchanges the API key plus a TOTP for a 24-hour access token. */
  generateAccessToken(
    params: { clientId: string; tOtp: string },
    signal?: AbortSignal,
  ): Promise<Schemas['AccessToken']> {
    return request<Schemas['AccessToken']>(this.config, {
      method: 'GET', path: '/auth/generate-access-token', auth: 'apiKey',
      query: { clientId: params.clientId, tOtp: params.tOtp }, signal,
    });
  }
}
