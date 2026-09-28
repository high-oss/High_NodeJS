// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { buildUrl, type ResolvedConfig } from './config.js';
import { errorFromResponse, HighApiError } from './errors.js';
import { redactUrl } from './logger.js';

export type AuthKind = 'bearer' | 'apiKey';

export interface RequestOptions {
  method: string;
  /** Operation path, already interpolated and encoded. */
  path: string;
  auth: AuthKind;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Caller's cancellation signal, composed with the SDK's timeout. */
  signal?: AbortSignal;
}

interface Attempt {
  status: number;
  data: unknown;
  error?: HighApiError;
  retryAfterMs?: number;
}

function headersFor(config: ResolvedConfig, options: RequestOptions): Headers {
  const headers = new Headers({
    accept: 'application/json',
    'user-agent': config.userAgent,
  });

  if (options.auth === 'bearer') {
    if (!config.accessToken) {
      throw new HighApiError(
        `This operation needs an accessToken. Pass it to the client, or set HIGH_ACCESS_TOKEN.`,
        { status: 0 },
      );
    }
    headers.set('authorization', `Bearer ${config.accessToken}`);
  } else {
    if (!config.apiKey) {
      throw new HighApiError(
        `This operation needs an apiKey. Pass it to the client, or set HIGH_API_KEY.`,
        { status: 0 },
      );
    }
    headers.set('x-api-key', config.apiKey);
  }

  if (options.body !== undefined) headers.set('content-type', 'application/json');
  return headers;
}

function urlFor(config: ResolvedConfig, options: RequestOptions): string {
  const url = new URL(buildUrl(config, options.path));
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

/**
 * Parses a `Retry-After` header. The spec allows either a delay in seconds or
 * an HTTP-date; treating it as a number unconditionally yields NaN for the
 * date form, so both are handled and anything else is ignored.
 */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.max(0, at - now);
  return undefined;
}

/**
 * Performs one HTTP exchange. Never throws for an API error status — the
 * caller's retry policy decides — but does throw for a transport failure it
 * cannot classify.
 */
async function attempt(
  config: ResolvedConfig,
  options: RequestOptions,
  url: string,
  headers: Headers,
): Promise<Attempt> {
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.timeoutMs);

  // Headers are never logged — they carry the bearer token and the api key.
  config.logger.debug(`HIGH -> ${options.method.toUpperCase()} ${redactUrl(url)}`);

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await config.fetch(url, {
      method: options.method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (timedOut) {
      config.logger.error(`HIGH <- timeout after ${config.timeoutMs}ms ${redactUrl(url)}`);
      throw new HighApiError(`Request timed out after ${config.timeoutMs}ms`, { status: 0, body: cause });
    }
    // A caller-initiated abort is their decision; surface it unchanged so it is
    // never mistaken for a timeout and never retried.
    if (options.signal?.aborted) throw options.signal.reason ?? cause;
    config.logger.error(`HIGH <- transport failure ${redactUrl(url)}`, (cause as Error).message);
    throw new HighApiError(`Request failed: ${(cause as Error).message}`, { status: 0, body: cause });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  }

  const text = await response.text();
  let parsed: unknown;
  let parseFailed = false;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      parseFailed = true;
    }
  }

  const envelope = parseFailed
    ? undefined
    : (parsed as { requestId?: string; data?: unknown } | undefined);

  config.logger.debug(
    `HIGH <- ${response.status} in ${Date.now() - startedAt}ms ${redactUrl(url)}`,
    envelope?.requestId ? { requestId: envelope.requestId } : undefined,
  );

  if (!response.ok) {
    return {
      status: response.status,
      data: undefined,
      error: errorFromResponse(response.status, parseFailed ? undefined : parsed, text),
      retryAfterMs: retryAfterMs(response.headers.get('retry-after')),
    };
  }

  if (parseFailed) {
    return {
      status: response.status,
      data: undefined,
      error: new HighApiError(`Expected JSON but the response was not parseable`, {
        status: response.status,
        body: text,
      }),
    };
  }

  return { status: response.status, data: envelope?.data };
}

/** True for statuses worth trying again on an idempotent operation. */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/** Only reads are retried. A retried POST /orders would be a duplicate order. */
const IDEMPOTENT = new Set(['GET', 'HEAD']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends one operation and returns its unwrapped `data`.
 *
 * Retries apply to idempotent reads only, on 429 and 5xx, honouring
 * `Retry-After` when present and backing off exponentially when it is not.
 * Writes are never retried.
 */
export async function request<T>(config: ResolvedConfig, options: RequestOptions): Promise<T> {
  const headers = headersFor(config, options);
  const url = urlFor(config, options);
  const retryable = IDEMPOTENT.has(options.method.toUpperCase());
  const maxAttempts = retryable ? config.maxRetries + 1 : 1;

  let last: Attempt | undefined;

  for (let index = 0; index < maxAttempts; index += 1) {
    last = await attempt(config, options, url, headers);

    if (!last.error) return last.data as T;
    if (!retryable || !RETRYABLE.has(last.status)) throw last.error;
    if (index === maxAttempts - 1) break;

    const backoff = 250 * 2 ** index + Math.floor(Math.random() * 100);
    const delay = last.retryAfterMs ?? backoff;
    config.logger.warn(
      `HIGH retry ${index + 1}/${maxAttempts - 1} after ${delay}ms (HTTP ${last.status}) ${redactUrl(url)}`,
    );
    await sleep(delay);
  }

  throw last!.error;
}
