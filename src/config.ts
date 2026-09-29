// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { createLogger, LOG_LEVELS, type LogLevel, type Logger, type LogSink } from './logger.js';

/**
 * The hosts for each environment. `api` comes from the spec's `servers` block,
 * by its `x-environment` name.
 *
 * `ws` is the datafeed socket host, reserved for the feed client that lands in
 * its own plan. It is declared here so the feed reuses this configuration and
 * these credentials rather than introducing a second config surface. Until the
 * socket contract exists, treat `ws` as provisional and override it with the
 * `wsBaseUrl` option.
 */
export const ENVIRONMENTS = {
  production: { api: 'https://openapi.high.live', ws: 'wss://openapi.high.live' },
  sandbox: { api: 'https://sandbox.high.live', ws: 'wss://sandbox.high.live' },
} as const;

export type Environment = keyof typeof ENVIRONMENTS;

/**
 * The CDN host the instrument list normally downloads from. Baked in as the
 * default allowlist entry so a compromised or mis-served download URL is
 * refused rather than silently followed.
 */
export const DEFAULT_INSTRUMENT_HOSTS = ['high-space.blr1.cdn.digitaloceanspaces.com'] as const;

export interface HighClientOptions {
  /** Which HIGH environment to talk to. Ignored when `baseUrl` is set. Default: production. */
  environment?: Environment;
  /** Overrides `environment` entirely. Use for a staging host or a local mock. */
  baseUrl?: string;
  /** Datafeed socket host. Reserved for the feed client; overrides `environment`. */
  wsBaseUrl?: string;
  /** API version segment between the host and the operation path. Default: `v1`. */
  versionPath?: string;
  /** Sent as `x-api-key`. Required by the four auth operations. */
  apiKey?: string;
  /** Sent as `Authorization: Bearer`. Required by the other 23 operations. */
  accessToken?: string;
  /** Per-request timeout. Default: 30000. */
  timeoutMs?: number;
  /** Retries for idempotent reads only. Default: 2. */
  maxRetries?: number;
  /**
   * Ceiling on a single retry delay. A `Retry-After` longer than this is not
   * waited out — the SDK gives up and throws instead. Default: 30000.
   */
  maxRetryDelayMs?: number;
  /** Appended to the SDK's own User-Agent. */
  userAgent?: string;
  /**
   * How much the SDK prints. Each level prints itself and everything more
   * severe. Default: `silent`. Credentials and TOTPs are redacted at every
   * level.
   */
  logLevel?: LogLevel;
  /** Where log lines go. Default: `console`. */
  logSink?: LogSink;
  /** Transport override, for tests or a proxy-aware fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Hosts the SDK will download instrument list files from. A download URL
   * whose host is not on this list is refused before any request is made.
   * Default: the host HIGH publishes them from.
   */
  instrumentsAllowedHosts?: string[];
}

export interface ResolvedConfig {
  baseUrl: string;
  /** Reserved for the datafeed client. Unused by the REST resources. */
  wsBaseUrl: string;
  versionPath: string;
  apiKey?: string;
  accessToken?: string;
  timeoutMs: number;
  maxRetries: number;
  maxRetryDelayMs: number;
  userAgent: string;
  logLevel: LogLevel;
  /** Ready to use; already honours `logLevel`. */
  logger: Logger;
  fetch: typeof globalThis.fetch;
  instrumentsAllowedHosts: string[];
}

const DEFAULT_USER_AGENT = 'high-sdk-node/0.0.1';

function assertEnvironment(value: string, source: string): asserts value is Environment {
  if (!(value in ENVIRONMENTS)) {
    const valid = Object.keys(ENVIRONMENTS).join(', ');
    throw new Error(`Unknown HIGH environment "${value}" (${source}). Valid values: ${valid}.`);
  }
}

function assertLogLevel(value: string, source: string): asserts value is LogLevel {
  if (!(LOG_LEVELS as readonly string[]).includes(value)) {
    throw new Error(
      `Unknown HIGH log level "${value}" (${source}). Valid values: ${LOG_LEVELS.join(', ')}.`,
    );
  }
}

const trimSlashes = (value: string): string => value.replace(/^\/+|\/+$/g, '');

/**
 * Settles where requests go and what they carry, once, at client construction.
 *
 * Resolution order: an explicit `baseUrl` wins outright; then an explicit
 * `environment`; then `HIGH_BASE_URL` / `HIGH_ENVIRONMENT`; then production.
 * An unknown environment fails here rather than at request time.
 */
export function resolveConfig(
  options: HighClientOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  // Settle which environment's hosts apply, then let explicit URLs override
  // either one independently — a developer may point the REST client at a local
  // mock while still using the real feed, or the reverse.
  let environment: Environment = 'production';
  if (options.environment !== undefined) {
    assertEnvironment(options.environment, 'options.environment');
    environment = options.environment;
  } else if (env.HIGH_ENVIRONMENT) {
    const fromEnv = env.HIGH_ENVIRONMENT;
    assertEnvironment(fromEnv, 'HIGH_ENVIRONMENT');
    environment = fromEnv;
  }

  const hosts = ENVIRONMENTS[environment];

  // An explicit `environment` suppresses the env-var hosts. Otherwise a
  // HIGH_BASE_URL left in a shell profile from a mock-server session would
  // silently route a client written as `environment: 'sandbox'` at production,
  // and could leave the REST host on one environment and the socket host on
  // the other. Only an explicit URL option outranks an explicit environment.
  const explicitEnvironment = options.environment !== undefined;
  const baseUrl =
    options.baseUrl ?? (explicitEnvironment ? hosts.api : env.HIGH_BASE_URL ?? hosts.api);
  const wsBaseUrl =
    options.wsBaseUrl ?? (explicitEnvironment ? hosts.ws : env.HIGH_WS_BASE_URL ?? hosts.ws);

  const userAgent = options.userAgent
    ? `${DEFAULT_USER_AGENT} ${options.userAgent}`
    : DEFAULT_USER_AGENT;

  let logLevel: LogLevel = 'silent';
  if (options.logLevel !== undefined) {
    assertLogLevel(options.logLevel, 'options.logLevel');
    logLevel = options.logLevel;
  } else if (env.HIGH_LOG_LEVEL) {
    const fromEnv = env.HIGH_LOG_LEVEL;
    assertLogLevel(fromEnv, 'HIGH_LOG_LEVEL');
    logLevel = fromEnv;
  }

  // Validated here rather than mid-request, so a bad number cannot surface as a
  // raw TypeError from deep inside the retry loop.
  const timeoutMs = requirePositive(options.timeoutMs ?? 30_000, 'timeoutMs');
  const maxRetries = requireNonNegative(options.maxRetries ?? 2, 'maxRetries');
  const maxRetryDelayMs = requirePositive(options.maxRetryDelayMs ?? 30_000, 'maxRetryDelayMs');
  const instrumentsAllowedHosts = requireHosts(
    options.instrumentsAllowedHosts ?? [...DEFAULT_INSTRUMENT_HOSTS],
    'instrumentsAllowedHosts',
  );

  const config: ResolvedConfig = {
    logLevel,
    logger: createLogger(logLevel, options.logSink),
    baseUrl: baseUrl.replace(/\/+$/, ''),
    wsBaseUrl: wsBaseUrl.replace(/\/+$/, ''),
    versionPath: trimSlashes(options.versionPath ?? 'v1'),
    timeoutMs,
    maxRetries,
    maxRetryDelayMs,
    userAgent,
    fetch: options.fetch ?? globalThis.fetch,
    instrumentsAllowedHosts,
  };

  // Credentials are defined non-enumerably so they survive neither
  // JSON.stringify nor util.inspect nor a crash reporter walking the client.
  // They are still ordinary property reads for the SDK itself.
  defineSecret(config, 'apiKey', options.apiKey ?? env.HIGH_API_KEY);
  defineSecret(config, 'accessToken', options.accessToken ?? env.HIGH_ACCESS_TOKEN);

  return config;
}

function requirePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, received ${value}.`);
  }
  return value;
}

function requireNonNegative(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer, received ${value}.`);
  }
  return value;
}

function requireHosts(value: string[], name: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((host) => !host)) {
    throw new Error(`${name} must be a non-empty array of hostnames, received ${JSON.stringify(value)}.`);
  }
  return value;
}

function defineSecret(target: ResolvedConfig, key: 'apiKey' | 'accessToken', value?: string): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: false,
    writable: false,
    configurable: true,
  });
}

/** `baseUrl` + `versionPath` + operation path, with no doubled or missing slashes. */
export function buildUrl(config: ResolvedConfig, path: string): string {
  const segments = [config.baseUrl, config.versionPath, trimSlashes(path)].filter(
    (segment) => segment !== '',
  );
  return segments.join('/');
}
