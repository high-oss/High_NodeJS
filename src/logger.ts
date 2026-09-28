// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Log levels, least to most verbose. Setting a level prints that level and
 * everything more severe: `warn` prints warnings and errors, `debug` prints
 * everything.
 */
export const LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'debug'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/** Anything that can receive the SDK's log lines. `console` satisfies it. */
export interface LogSink {
  error: (message: string, detail?: unknown) => void;
  warn: (message: string, detail?: unknown) => void;
  info: (message: string, detail?: unknown) => void;
  debug: (message: string, detail?: unknown) => void;
}

export interface Logger extends LogSink {
  /** True when this level would print. Guard expensive detail with it. */
  enabled: (level: Exclude<LogLevel, 'silent'>) => boolean;
}

/**
 * Query parameters that must never reach a log sink. `tOtp` is a live
 * second factor and the token parameters are bearer credentials — a caller
 * shipping debug logs to an aggregator would otherwise ship these with them.
 */
const SENSITIVE_PARAMS = new Set(['tOtp', 'apiKey', 'accessToken', 'tokenId', 'stepToken']);

/** Replaces sensitive query parameter values with `REDACTED`. */
export function redactUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can parse — return it as-is rather than throwing inside a
    // log call, which would turn an observability feature into an outage.
    return url;
  }

  let touched = false;
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_PARAMS.has(key)) {
      parsed.searchParams.set(key, 'REDACTED');
      touched = true;
    }
  }
  return touched ? parsed.toString() : url;
}

/**
 * Object keys whose values must never be logged, whatever nesting they sit at.
 * Query parameters are handled by `redactUrl`; this covers request and response
 * bodies, which is where a future endpoint could start carrying a secret.
 */
const SENSITIVE_KEYS = new Set([
  'tOtp', 'totp', 'otp', 'apiKey', 'accessToken', 'refreshToken',
  'tokenId', 'stepToken', 'password', 'pin', 'authorization',
]);

/** Above this, a logged payload is replaced by a note rather than printed. */
const MAX_LOGGED_JSON = 1500;

/**
 * Deep-copies a payload for logging, masking credential-shaped keys and
 * replacing anything oversized with a note. Returns primitives untouched.
 */
export function redactBody(value: unknown): unknown {
  if (value === null || value === undefined || typeof value !== 'object') return value;

  const mask = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(mask);
    if (input === null || typeof input !== 'object') return input;
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEYS.has(key) ? 'REDACTED' : mask(nested),
      ]),
    );
  };

  const masked = mask(value);

  let serialised: string;
  try {
    serialised = JSON.stringify(masked) ?? '';
  } catch {
    return '[unserialisable]';
  }
  if (serialised.length > MAX_LOGGED_JSON) {
    return `[truncated: ${serialised.length} bytes of JSON]`;
  }
  return masked;
}

const RANK: Record<LogLevel, number> = {
  silent: 0, error: 1, warn: 2, info: 3, debug: 4,
};

/** `2026-09-28T17:05:12.345Z DEBUG message` — sortable, and aligned in a terminal. */
function format(level: Exclude<LogLevel, 'silent'>, message: string): string {
  return `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
}

const CONSOLE_SINK: LogSink = {
  error: (m, d) => (d === undefined ? console.error(m) : console.error(m, d)),
  warn: (m, d) => (d === undefined ? console.warn(m) : console.warn(m, d)),
  info: (m, d) => (d === undefined ? console.info(m) : console.info(m, d)),
  debug: (m, d) => (d === undefined ? console.debug(m) : console.debug(m, d)),
};

/**
 * Builds a logger that drops anything below `level`. The default level is
 * `silent`: a library that prints uninvited is a bad citizen in someone else's
 * application.
 */
export function createLogger(level: LogLevel, sink: LogSink = CONSOLE_SINK): Logger {
  const threshold = RANK[level];
  const enabled = (want: Exclude<LogLevel, 'silent'>) => RANK[want] <= threshold;

  return {
    enabled,
    error: (m, d) => { if (enabled('error')) sink.error(format('error', m), d); },
    warn: (m, d) => { if (enabled('warn')) sink.warn(format('warn', m), d); },
    info: (m, d) => { if (enabled('info')) sink.info(format('info', m), d); },
    debug: (m, d) => { if (enabled('debug')) sink.debug(format('debug', m), d); },
  };
}
