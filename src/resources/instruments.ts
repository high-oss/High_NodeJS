// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import type { components } from '../../generated/openapi.js';
import { CsvRowSplitter } from '../csv.js';
import type { ResolvedConfig } from '../config.js';
import { errorFromResponse, HighApiError } from '../errors.js';
import { request } from '../http.js';
import { redactUrl } from '../logger.js';

type Schemas = components['schemas'];

/**
 * Which scrips to list. Derived from the generated enum rather than widened to
 * `string`, so a category the contract does not know about is a compile-time
 * error, not a request that fails at runtime.
 */
export type InstrumentCategory = Schemas['InstrumentFile']['instrument'];

/** One row of the instrument list, typed and blank-as-`undefined`. */
export interface InstrumentRow {
  exchange: string;
  segment: string;
  /** The scrip's own type, e.g. `EQUITY`, `FUTSTK`, `OPTIDX` — unrelated to `InstrumentCategory`. */
  instrument: string;
  highTradingSymbol: string;
  scripKey: string;
  /** Equity only. */
  isin?: string;
  /** Broker-assigned numeric id. */
  scripCode: number;
  symbol: string;
  /** May contain commas. */
  name: string;
  groupSeries?: string;
  /** `1` when the scrip has a listed futures-and-options chain, `0` otherwise. */
  hasFno: number;
  /** Derivatives only. */
  underlyingSymbol?: string;
  /** Derivatives only. Left as the CSV's own date string — not parsed into a `Date`. */
  expiry?: string;
  /** Options only. */
  optionType?: string;
  /** Options only. */
  strikePrice?: number;
  /**
   * Minimum price movement. Its scale is segment-specific (paise for some
   * segments, a different unit for others) — reported exactly as published,
   * never rescaled, because normalising it here would be a silent pricing bug
   * for whichever segment's convention this SDK guessed wrong.
   */
  priceTick: number;
  lotSize: number;
}

export interface InstrumentsRequestOptions {
  signal?: AbortSignal;
  /**
   * Overrides the client's `timeoutMs` for this call only, covering the whole
   * download — including however long your own iteration between rows takes.
   * `all` and `derivatives` are 14 MB and 11 MB; raise this if the default
   * (`config.timeoutMs`, 30s) is not enough for your connection or your
   * per-row processing.
   */
  timeoutMs?: number;
}

interface ColumnSpec {
  name: string;
  key: keyof InstrumentRow;
  type: 'string' | 'int' | 'number';
  required: boolean;
}

// Order matches the manifest's documented column order, but lookups below are
// by name — not position — so this still works if a future manifest reorders
// its columns without changing their names.
const COLUMN_SPECS: readonly ColumnSpec[] = [
  { name: 'exchange', key: 'exchange', type: 'string', required: true },
  { name: 'segment', key: 'segment', type: 'string', required: true },
  { name: 'instrument', key: 'instrument', type: 'string', required: true },
  { name: 'high_trading_symbol', key: 'highTradingSymbol', type: 'string', required: true },
  { name: 'scrip_key', key: 'scripKey', type: 'string', required: true },
  { name: 'isin', key: 'isin', type: 'string', required: false },
  { name: 'scrip_code', key: 'scripCode', type: 'int', required: true },
  { name: 'symbol', key: 'symbol', type: 'string', required: true },
  { name: 'name', key: 'name', type: 'string', required: true },
  { name: 'group_series', key: 'groupSeries', type: 'string', required: false },
  { name: 'has_fno', key: 'hasFno', type: 'int', required: true },
  { name: 'underlying_symbol', key: 'underlyingSymbol', type: 'string', required: false },
  { name: 'expiry', key: 'expiry', type: 'string', required: false },
  { name: 'option_type', key: 'optionType', type: 'string', required: false },
  { name: 'strike_price', key: 'strikePrice', type: 'number', required: false },
  { name: 'price_tick', key: 'priceTick', type: 'int', required: true },
  { name: 'lot_size', key: 'lotSize', type: 'int', required: true },
];

/**
 * Refuses a download URL before any request is made: it must be `https`, and
 * its host must be on the allowlist. The manifest is server data — a
 * compromised gateway or a MITM on the manifest response is exactly the case
 * this exists to catch, since the alternative is the SDK dutifully attaching
 * nothing to the request (see below) and following the URL anyway.
 */
function assertAllowedDownloadUrl(config: ResolvedConfig, rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HighApiError(`Instrument download URL is not a valid URL: "${rawUrl}"`, { status: 0 });
  }
  if (url.protocol !== 'https:') {
    throw new HighApiError(
      `Refusing to download instruments over "${url.protocol}" — only https is allowed (${rawUrl}).`,
      { status: 0 },
    );
  }
  if (!config.instrumentsAllowedHosts.includes(url.hostname)) {
    throw new HighApiError(
      `Refusing to download instruments from host "${url.hostname}", which is not in ` +
        `instrumentsAllowedHosts (${config.instrumentsAllowedHosts.join(', ')}).`,
      { status: 0 },
    );
  }
  return url;
}

function assertHeaderMatchesManifest(header: string[], columns: string[]): void {
  const matches = header.length === columns.length && header.every((h, i) => h === columns[i]);
  if (matches) return;
  throw new HighApiError(
    `Instrument CSV header does not match the manifest's columns — refusing to guess field ` +
      `positions.\nExpected: ${columns.join(', ')}\nReceived: ${header.join(', ')}`,
    { status: 0 },
  );
}

function buildColumnIndex(header: string[]): Map<string, number> {
  const index = new Map<string, number>();
  header.forEach((name, position) => index.set(name, position));
  return index;
}

function assertRequiredColumnsPresent(index: Map<string, number>): void {
  const missing = COLUMN_SPECS.filter((spec) => spec.required && !index.has(spec.name)).map(
    (spec) => spec.name,
  );
  if (missing.length > 0) {
    throw new HighApiError(
      `Instrument CSV is missing required column(s): ${missing.join(', ')}.`,
      { status: 0 },
    );
  }
}

function parseRow(fields: string[], index: Map<string, number>, rowNumber: number): InstrumentRow {
  const out: Record<string, string | number | undefined> = {};

  for (const spec of COLUMN_SPECS) {
    const position = index.get(spec.name);
    const raw = position === undefined ? '' : (fields[position] ?? '').trim();

    if (raw === '') {
      if (spec.required) {
        throw new HighApiError(
          `Instrument CSV row ${rowNumber} is missing a value for required column "${spec.name}".`,
          { status: 0 },
        );
      }
      out[spec.key] = undefined;
      continue;
    }

    if (spec.type === 'string') {
      out[spec.key] = raw;
    } else if (spec.type === 'int') {
      const value = Number.parseInt(raw, 10);
      if (!Number.isFinite(value)) {
        throw new HighApiError(
          `Instrument CSV row ${rowNumber} has a non-numeric value for "${spec.name}": "${raw}".`,
          { status: 0 },
        );
      }
      out[spec.key] = value;
    } else {
      const value = Number.parseFloat(raw);
      if (!Number.isFinite(value)) {
        throw new HighApiError(
          `Instrument CSV row ${rowNumber} has a non-numeric value for "${spec.name}": "${raw}".`,
          { status: 0 },
        );
      }
      out[spec.key] = value;
    }
  }

  return out as unknown as InstrumentRow;
}

/**
 * Streams and parses one instrument CSV. No credentials are ever attached —
 * neither `Authorization` nor `x-api-key` — because the CDN this downloads
 * from is a third-party host, not the HIGH API.
 *
 * The whole exchange, headers and body, is bounded by `timeoutMs`: reading
 * proceeds at whatever pace the caller consumes the generator, so a caller
 * that processes rows slowly should pass a larger override rather than rely
 * on the default.
 */
async function* downloadCsvRows(
  config: ResolvedConfig,
  url: string,
  manifestColumns: string[],
  options: InstrumentsRequestOptions,
): AsyncGenerator<InstrumentRow> {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const settle = () => {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onCallerAbort);
  };

  config.logger.info(`HIGH -> GET ${redactUrl(url)}`);

  let response: Response;
  try {
    // Deliberately no `authorization`, no `x-api-key` — see the doc comment.
    response = await config.fetch(url, {
      method: 'GET',
      headers: { accept: 'text/csv', 'user-agent': config.userAgent },
      signal: controller.signal,
    });
  } catch (cause) {
    settle();
    if (timedOut) {
      config.logger.error(`HIGH <- timeout after ${timeoutMs}ms ${redactUrl(url)}`);
      throw new HighApiError(`Instrument download timed out after ${timeoutMs}ms`, {
        status: 0,
        body: cause,
      });
    }
    if (options.signal?.aborted) throw options.signal.reason ?? cause;
    config.logger.error(`HIGH <- transport failure ${redactUrl(url)}`, (cause as Error).message);
    throw new HighApiError(`Instrument download failed: ${(cause as Error).message}`, {
      status: 0,
      body: cause,
    });
  }

  if (!response.ok) {
    settle();
    const text = await response.text().catch(() => '');
    config.logger.error(`HIGH <- ${response.status} ${redactUrl(url)}`);
    throw errorFromResponse(response.status, undefined, text);
  }

  if (!response.body) {
    settle();
    throw new HighApiError('Instrument download had no response body', { status: response.status });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const splitter = new CsvRowSplitter();

  let headerChecked = false;
  let index: Map<string, number> | undefined;
  let rowNumber = 0;

  try {
    for (;;) {
      let done: boolean;
      let value: Uint8Array | undefined;
      try {
        ({ done, value } = await reader.read());
      } catch (cause) {
        if (timedOut) {
          throw new HighApiError(
            `Instrument download timed out after ${timeoutMs}ms while reading the body`,
            { status: 0, body: cause },
          );
        }
        if (options.signal?.aborted) throw options.signal.reason ?? cause;
        throw new HighApiError(
          `Instrument download failed while reading the body: ${(cause as Error).message}`,
          { status: 0, body: cause },
        );
      }

      const text = value ? decoder.decode(value, { stream: !done }) : done ? decoder.decode() : '';
      const rows = text ? splitter.push(text) : [];
      if (done) rows.push(...splitter.finish());

      for (const fields of rows) {
        if (!headerChecked) {
          assertHeaderMatchesManifest(fields, manifestColumns);
          index = buildColumnIndex(fields);
          assertRequiredColumnsPresent(index);
          headerChecked = true;
          continue;
        }
        rowNumber += 1;
        yield parseRow(fields, index!, rowNumber);
      }

      if (done) break;
    }
  } finally {
    settle();
    await reader.cancel().catch(() => {});
  }
}

export class InstrumentsResource {
  private manifestPromise?: Promise<Schemas['InstrumentsManifest']>;

  constructor(private readonly config: ResolvedConfig) {}

  /**
   * Streams parsed rows for one category — the primary form. `all` and
   * `derivatives` are 14 MB and 11 MB; this never holds the whole file in
   * memory at once.
   */
  async *stream(
    category: InstrumentCategory,
    options: InstrumentsRequestOptions = {},
  ): AsyncIterable<InstrumentRow> {
    const { url, columns } = await this.resolve(category, options.signal);
    yield* downloadCsvRows(this.config, url, columns, options);
  }

  /**
   * Materialises every row into an array. Convenient for the smaller
   * categories (`equity`, `commodity`, `etfs`); for `all` or `derivatives`,
   * prefer {@link InstrumentsResource.stream}.
   */
  async list(
    category: InstrumentCategory,
    options: InstrumentsRequestOptions = {},
  ): Promise<InstrumentRow[]> {
    const rows: InstrumentRow[] = [];
    for await (const row of this.stream(category, options)) rows.push(row);
    return rows;
  }

  /**
   * Fetches the download locations once and caches them for the client's
   * lifetime — the files this points at are rebuilt once a trading morning,
   * so re-fetching this on every call would only add latency.
   */
  private manifest(signal?: AbortSignal): Promise<Schemas['InstrumentsManifest']> {
    if (!this.manifestPromise) {
      // `auth: 'none'` — this operation is unauthenticated, and the credential
      // path in the shared request layer is skipped entirely for it.
      const promise = request<Schemas['InstrumentsManifest']>(this.config, {
        method: 'GET',
        path: '/instruments',
        auth: 'none',
        signal,
      });
      this.manifestPromise = promise;
      // A failed fetch must not be cached forever — the next call gets a
      // fresh attempt rather than repeating today's failure indefinitely.
      promise.catch(() => {
        if (this.manifestPromise === promise) this.manifestPromise = undefined;
      });
    }
    return this.manifestPromise;
  }

  private async resolve(
    category: InstrumentCategory,
    signal?: AbortSignal,
  ): Promise<{ url: string; columns: string[] }> {
    const manifest = await this.manifest(signal);
    // Entries the SDK does not recognise (a category added server-side after
    // this SDK shipped) are simply not matched below — never a crash.
    const entry = manifest.files.find((file) => file.instrument === category);
    if (!entry) {
      const available = manifest.files.map((file) => file.instrument).join(', ') || '(none)';
      throw new HighApiError(
        `Instrument category "${category}" is not available right now. Available: ${available}.`,
        { status: 0 },
      );
    }
    assertAllowedDownloadUrl(this.config, entry.url);
    return { url: entry.url, columns: manifest.columns };
  }
}
