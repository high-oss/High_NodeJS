// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * The documented error catalogue, from the spec's `Error.code['x-error-codes']`.
 *
 * It is a list and not a closed union on purpose: the gateway defines far more
 * codes than the catalogue documents and passes most through unchanged, so an
 * exhaustive union would make `error.code` unassignable for a code that is
 * perfectly real. Compare against these constants; expect others.
 */
export const ERROR_CODES = [
  'INVALID_API_KEY',
  'INVALID_CONSENT',
  'INVALID_DATE',
  'INVALID_SCRIP',
  'INVALID_TOKEN',
  'INVALID_TOKEN_ID',
  'INVALID_TOTP',
  'ORDER_DETAILS_INVALID',
  'ORDER_NOT_CANCELLABLE',
  'ORDER_NOT_FOUND',
  'ORDER_REJECTED',
  'ORDER_STATUS_UNKNOWN',
  'OWNER_MISMATCH',
  'POSITION_CONVERT_FAILED',
  'POSITION_NOT_EXITABLE',
  'POSITION_SQUARE_OFF_FAILED',
  'QUANTITY_NOT_IN_LOTS',
  'REDIRECT_URL_NOT_CONFIGURED',
  'SANDBOX_TOKEN_NOT_ALLOWED',
  'SCRIP_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'SESSION_EXPIRED',
  'SESSION_NOT_GENERATED',
  'STATIC_IP_MISMATCH',
  'STATIC_IP_MISSING',
  'TOTP_NOT_ENABLED',
  'UNHANDLED_ERROR',
  'VALIDATION_ERROR',
  'WRONG_TOKEN_AUDIENCE',
] as const;

/** A documented code, with any other string still permitted. */
export type ErrorCode = (typeof ERROR_CODES)[number] | (string & {});

export interface HighApiErrorInit {
  status: number;
  code?: ErrorCode;
  requestId?: string;
  messages?: string[];
  body?: unknown;
}

/** Every failure the SDK surfaces — transport, timeout, or an API error response. */
export class HighApiError extends Error {
  readonly status: number;
  readonly code?: ErrorCode;
  /** Quote this in support tickets. */
  readonly requestId?: string;
  /** Every message the API returned; validation errors return several. */
  readonly messages?: string[];
  /** The parsed body, when there was one. */
  readonly body?: unknown;

  constructor(message: string, init: HighApiErrorInit) {
    super(message);
    this.name = 'HighApiError';
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.messages = init.messages;
    this.body = init.body;
  }
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

function messagesOf(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : undefined;
  }
  return undefined;
}

/**
 * Builds the error for a non-2xx response. `body` is the parsed JSON when the
 * response had any; `fallbackText` is the raw text when it did not — a proxy or
 * load balancer failure returns HTML, and losing that to a JSON parse error
 * would hide the status the caller needs.
 */
export function errorFromResponse(
  status: number,
  body: unknown,
  fallbackText?: string,
): HighApiError {
  const record = asRecord(body);
  const messages = messagesOf(record?.message);
  const snippet = fallbackText?.trim().slice(0, 200);

  const message =
    messages?.join('; ') ??
    (snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`);

  return new HighApiError(message, {
    status,
    code: asString(record?.code),
    requestId: asString(record?.requestId),
    messages,
    body: body ?? fallbackText,
  });
}
