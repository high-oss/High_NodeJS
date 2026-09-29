// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { HighFeedError } from './errors.js';

/** Which stream a caller subscribes to. */
export type FeedKind = 'quote' | 'depth' | 'index';

/**
 * A live quote — the market-watch fields, keyed by the caller's own scrip
 * key. Prices arrive as decimal strings and stay strings: the wire's `ltp`
 * `1905.65` is never parsed to a binary float, which would silently lose or
 * distort precision for money.
 */
export interface Quote {
  readonly scripKey: string;
  readonly tradingSymbol?: string;
  readonly lastTradedPrice?: string;
  readonly lastTradedQuantity?: number;
  /** IST wall-clock, from the wire's `dd/MM/yyyy HH:mm:ss`. */
  readonly lastTradedTime?: Date;
  readonly volume?: number;
  readonly turnover?: string;
  readonly averageTradePrice?: string;
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  /** The prior session's close, not today's. */
  readonly previousClose?: string;
  readonly yearHigh?: string;
  readonly yearLow?: string;
  /** Absolute change. Note this is the wire's `cng`, not `nc` — see {@link Quote.changePercent}. */
  readonly change?: string;
  /** Percentage change. This is the wire's `nc` — the vendor's own sample README has these two swapped; the arithmetic settles it. */
  readonly changePercent?: string;
  readonly totalBuyQuantity?: number;
  readonly totalSellQuantity?: number;
  readonly openInterest?: number;
  readonly lowerCircuitLimit?: string;
  readonly upperCircuitLimit?: string;
  /** IST wall-clock, from the wire's `dd-MMM-yyyy HH:mm:ss`. */
  readonly feedTime?: Date;
  readonly multiplier?: number;
  readonly precision?: number;
  /** Wire fields this SDK does not yet name, preserved exactly as received rather than dropped. */
  readonly extra?: Readonly<Record<string, string>>;
}

export interface DepthLevel {
  readonly price?: string;
  readonly quantity?: number;
  /** Present for a `depth`-sourced level; absent for the one level split out of a quote tick. */
  readonly orders?: number;
}

/**
 * One side's book, or the single top-of-book level split out of a FULL quote
 * tick. `levels` and `source` say which: a one-level book from `quote` must
 * never be mistaken for a five-level one from `depth`, which is why both are
 * carried on the model rather than left for the caller to infer from array
 * length.
 */
export interface Depth {
  readonly scripKey: string;
  /** `1` for the top-of-book split out of a quote tick; `5` for a dedicated depth subscription. */
  readonly levels: 1 | 5;
  readonly source: 'quote' | 'depth';
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
}

export interface IndexTick {
  readonly scripKey: string;
  readonly indexName?: string;
  readonly indexValue?: string;
  readonly previousClose?: string;
  readonly open?: string;
  readonly high?: string;
  readonly low?: string;
  readonly change?: string;
  readonly changePercent?: string;
  /** IST wall-clock, from the wire's `dd-MMM-yyyy HH:mm:ss`. */
  readonly feedTime?: Date;
  readonly multiplier?: number;
  readonly precision?: number;
  readonly extra?: Readonly<Record<string, string>>;
}

export interface QuoteTickEvent {
  readonly kind: 'quote';
  readonly scripKey: string;
  readonly data: Quote;
  readonly changedFields: ReadonlySet<string>;
}

export interface DepthTickEvent {
  readonly kind: 'depth';
  readonly scripKey: string;
  readonly data: Depth;
  readonly changedFields: ReadonlySet<string>;
}

export interface IndexTickEvent {
  readonly kind: 'index';
  readonly scripKey: string;
  readonly data: IndexTick;
  readonly changedFields: ReadonlySet<string>;
}

/** Everything `HighFeed` delivers, whether through an event or the async iterator. */
export type FeedTickEvent = QuoteTickEvent | DepthTickEvent | IndexTickEvent;

// ---------------------------------------------------------------------------
// Parsing. Every wire value arrives as a string (or is absent); each parser
// trims leading/trailing space first — the index sample's own
// `"openingprice":" 9408.60"` shows the vendor does not always trim on its
// side — and returns `undefined` for a blank or missing value rather than
// `''` or `NaN`.
// ---------------------------------------------------------------------------

function trimmedString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Prices and other decimal wire values: kept as a trimmed string, never parsed to a binary float. */
function decimalString(raw: unknown): string | undefined {
  return trimmedString(raw);
}

function integer(raw: unknown): number | undefined {
  const text = trimmedString(raw);
  if (text === undefined) return undefined;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : undefined;
}

const IST_OFFSET_MINUTES = 5 * 60 + 30;

function istToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): Date {
  // The wire carries IST wall-clock with no offset of its own; subtracting
  // the fixed +05:30 offset from a UTC construction yields the correct
  // instant rather than mistaking the wall-clock for UTC.
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - IST_OFFSET_MINUTES * 60_000);
}

const SLASH_DATETIME = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** `dd/MM/yyyy HH:mm:ss`, IST — the wire's `ltt`. */
function slashDateTime(raw: unknown): Date | undefined {
  const text = trimmedString(raw);
  if (text === undefined) return undefined;
  const match = SLASH_DATETIME.exec(text);
  if (!match) throw new HighFeedError(`Unrecognised "dd/MM/yyyy HH:mm:ss" timestamp: "${text}"`);
  const [, dd, mm, yyyy, hh, mi, ss] = match;
  return istToUtc(Number(yyyy), Number(mm), Number(dd), Number(hh), Number(mi), Number(ss));
}

const MONTHS: Readonly<Record<string, number>> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const DASH_DATETIME = /^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/** `dd-MMM-yyyy HH:mm:ss`, IST — the wire's `fdtm` and the index's `tvalue`. */
function dashDateTime(raw: unknown): Date | undefined {
  const text = trimmedString(raw);
  if (text === undefined) return undefined;
  const match = DASH_DATETIME.exec(text);
  if (!match) throw new HighFeedError(`Unrecognised "dd-MMM-yyyy HH:mm:ss" timestamp: "${text}"`);
  const [, dd, mon, yyyy, hh, mi, ss] = match;
  const month = MONTHS[mon!];
  if (month === undefined) throw new HighFeedError(`Unrecognised month "${mon}" in timestamp "${text}"`);
  return istToUtc(Number(yyyy), month, Number(dd), Number(hh), Number(mi), Number(ss));
}

// ---------------------------------------------------------------------------
// Field maps. Normative names from the datafeed-socket plan's field table —
// adapted only for casing. `e`, `tk`, `name` and `type` are routing/internal
// and never appear here (except `tk`/`ts`, which the index frame maps to the
// public `indexName`).
// ---------------------------------------------------------------------------

type FieldParser = (raw: unknown) => unknown;
interface FieldSpec {
  readonly publicName: string;
  readonly parse: FieldParser;
}

/** Keys present on every tick element that are routing/internal, never surfaced or preserved as `extra`. */
const INTERNAL_KEYS = new Set(['e', 'tk', 'name', 'type']);

const QUOTE_FIELD_MAP: Readonly<Record<string, FieldSpec>> = {
  ts: { publicName: 'tradingSymbol', parse: trimmedString },
  ltp: { publicName: 'lastTradedPrice', parse: decimalString },
  ltq: { publicName: 'lastTradedQuantity', parse: integer },
  ltt: { publicName: 'lastTradedTime', parse: slashDateTime },
  v: { publicName: 'volume', parse: integer },
  to: { publicName: 'turnover', parse: decimalString },
  ap: { publicName: 'averageTradePrice', parse: decimalString },
  op: { publicName: 'open', parse: decimalString },
  h: { publicName: 'high', parse: decimalString },
  lo: { publicName: 'low', parse: decimalString },
  c: { publicName: 'previousClose', parse: decimalString },
  yh: { publicName: 'yearHigh', parse: decimalString },
  yl: { publicName: 'yearLow', parse: decimalString },
  cng: { publicName: 'change', parse: decimalString },
  nc: { publicName: 'changePercent', parse: decimalString },
  tbq: { publicName: 'totalBuyQuantity', parse: integer },
  tsq: { publicName: 'totalSellQuantity', parse: integer },
  oi: { publicName: 'openInterest', parse: integer },
  lcl: { publicName: 'lowerCircuitLimit', parse: decimalString },
  ucl: { publicName: 'upperCircuitLimit', parse: decimalString },
  fdtm: { publicName: 'feedTime', parse: dashDateTime },
  mul: { publicName: 'multiplier', parse: integer },
  prec: { publicName: 'precision', parse: integer },
};

/** Top-of-book, split out of a FULL-mode quote tick into its own `depth` event. */
const TOP_OF_BOOK_FIELD_MAP: Readonly<Record<string, FieldSpec>> = {
  bp: { publicName: 'bestBidPrice', parse: decimalString },
  bq: { publicName: 'bestBidQuantity', parse: integer },
  sp: { publicName: 'bestAskPrice', parse: decimalString },
  bs: { publicName: 'bestAskQuantity', parse: integer },
};

const INDEX_FIELD_MAP: Readonly<Record<string, FieldSpec>> = {
  tk: { publicName: 'indexName', parse: trimmedString },
  ts: { publicName: 'indexName', parse: trimmedString },
  iv: { publicName: 'indexValue', parse: decimalString },
  ic: { publicName: 'previousClose', parse: decimalString },
  openingprice: { publicName: 'open', parse: decimalString },
  highprice: { publicName: 'high', parse: decimalString },
  lowprice: { publicName: 'low', parse: decimalString },
  cng: { publicName: 'change', parse: decimalString },
  nc: { publicName: 'changePercent', parse: decimalString },
  tvalue: { publicName: 'feedTime', parse: dashDateTime },
  mul: { publicName: 'multiplier', parse: integer },
  prec: { publicName: 'precision', parse: integer },
};

/** Depth-array keys for one side, in level order 1..5, with their two numbering bases reconciled. */
function levelKeys(priceBase: string, qtyBase: string, ordersBase: string): readonly [string, string, string][] {
  return [1, 2, 3, 4, 5].map((level) => {
    // Level 1 is the unnumbered key; levels 2-5 are `<base>1`..`<base>4`. Order
    // counts have no unnumbered form — they start at 1 — so level n pairs
    // `<priceBase>{n-1}` (or the bare key for n=1) with `<ordersBase>{n}`.
    const suffix = level === 1 ? '' : String(level - 1);
    return [`${priceBase}${suffix}`, `${qtyBase}${suffix}`, `${ordersBase}${level}`] as [string, string, string];
  });
}

const BID_LEVEL_KEYS = levelKeys('bp', 'bq', 'bno');
const ASK_LEVEL_KEYS = levelKeys('sp', 'bs', 'sno');

/** Every wire key a `dp` tick can carry — used to tell a depth field from an unrecognised one. */
const DEPTH_KEYS = new Set([...BID_LEVEL_KEYS, ...ASK_LEVEL_KEYS].flat());

// ---------------------------------------------------------------------------
// Merge + build. `HighFeed` keeps one merged raw dict per scripKey per frame
// family and calls these on every tick; they never mutate their input.
// ---------------------------------------------------------------------------

export type RawTick = Readonly<Record<string, unknown>>;

/** Merges a delta tick over the previous merged state, dropping the routing keys — deltas only ever add or replace, never remove. */
export function mergeRaw(previous: RawTick | undefined, tick: RawTick): RawTick {
  const merged: Record<string, unknown> = { ...previous };
  for (const [key, value] of Object.entries(tick)) {
    if (INTERNAL_KEYS.has(key)) continue;
    merged[key] = value;
  }
  return merged;
}

/** The wire keys this particular tick actually carried — the true "changed" set, since only changed fields arrive. */
export function changedWireKeys(tick: RawTick): string[] {
  return Object.keys(tick).filter((key) => !INTERNAL_KEYS.has(key));
}

function buildExtra(merged: RawTick, known: ReadonlySet<string>): Record<string, string> | undefined {
  const extra: Record<string, string> = {};
  let any = false;
  for (const [key, value] of Object.entries(merged)) {
    if (known.has(key)) continue;
    const text = trimmedString(value) ?? (value === undefined ? undefined : String(value));
    if (text === undefined) continue;
    extra[key] = text;
    any = true;
  }
  return any ? extra : undefined;
}

/**
 * Builds the quote half of a `sf` tick, and the set of changed quote fields
 * (excluding top-of-book ones — those belong to {@link buildTopOfBookDepth}).
 * Returns `undefined` when this particular delta touched no quote field, so
 * the caller knows not to emit a `quote` event for it.
 */
export function buildQuote(
  scripKey: string,
  merged: RawTick,
  changedKeys: readonly string[],
): { quote: Quote; changedFields: Set<string> } | undefined {
  const changedFields = new Set<string>();
  for (const key of changedKeys) {
    if (key in TOP_OF_BOOK_FIELD_MAP) continue;
    const spec = QUOTE_FIELD_MAP[key];
    changedFields.add(spec ? spec.publicName : key);
  }
  if (changedFields.size === 0) return undefined;

  const quote: Record<string, unknown> = { scripKey };
  for (const [key, spec] of Object.entries(QUOTE_FIELD_MAP)) {
    const value = spec.parse(merged[key]);
    if (value !== undefined) quote[spec.publicName] = value;
  }
  const known = new Set([...Object.keys(QUOTE_FIELD_MAP), ...Object.keys(TOP_OF_BOOK_FIELD_MAP)]);
  const extra = buildExtra(merged, known);
  if (extra) quote['extra'] = extra;

  return { quote: quote as unknown as Quote, changedFields };
}

/**
 * Builds the one-level book split out of a `sf` tick's top-of-book fields.
 * Returns `undefined` when this delta touched none of `bp`/`bq`/`sp`/`bs` —
 * the FULL/two-events split only fires a `depth` event when it has to.
 */
export function buildTopOfBookDepth(
  scripKey: string,
  merged: RawTick,
  changedKeys: readonly string[],
): { depth: Depth; changedFields: Set<string> } | undefined {
  const changedFields = new Set<string>();
  for (const key of changedKeys) {
    const spec = TOP_OF_BOOK_FIELD_MAP[key];
    if (spec) changedFields.add(spec.publicName);
  }
  if (changedFields.size === 0) return undefined;

  const bid: DepthLevel = { price: decimalString(merged['bp']), quantity: integer(merged['bq']) };
  const ask: DepthLevel = { price: decimalString(merged['sp']), quantity: integer(merged['bs']) };

  return {
    depth: { scripKey, levels: 1, source: 'quote', bids: [bid], asks: [ask] },
    changedFields,
  };
}

/**
 * Builds the five-level book from a `dp` tick. Levels are numbered 1..5;
 * price/quantity keys are unnumbered at level 1 and `1`..`4` after, while
 * order-count keys are numbered `1`..`5` throughout — level *n* therefore
 * pairs `bp{n-1}` (or the bare `bp` at n=1) with `bno{n}`, not the same
 * suffix on both, which is the off-by-one the plan calls out explicitly.
 */
export function buildDepth(
  scripKey: string,
  merged: RawTick,
  changedKeys: readonly string[],
): { depth: Depth; changedFields: Set<string> } {
  const changedFields = new Set<string>();
  for (const key of changedKeys) {
    if (DEPTH_KEYS.has(key)) changedFields.add(key);
  }

  const buildSide = (keys: readonly [string, string, string][]): DepthLevel[] =>
    keys.map(([priceKey, qtyKey, ordersKey]) => ({
      price: decimalString(merged[priceKey]),
      quantity: integer(merged[qtyKey]),
      orders: integer(merged[ordersKey]),
    }));

  return {
    depth: {
      scripKey,
      levels: 5,
      source: 'depth',
      bids: buildSide(BID_LEVEL_KEYS),
      asks: buildSide(ASK_LEVEL_KEYS),
    },
    changedFields,
  };
}

export function buildIndexTick(
  scripKey: string,
  merged: RawTick,
  changedKeys: readonly string[],
): { indexTick: IndexTick; changedFields: Set<string> } {
  const changedFields = new Set<string>();
  for (const key of changedKeys) {
    const spec = INDEX_FIELD_MAP[key];
    changedFields.add(spec ? spec.publicName : key);
  }

  const indexTick: Record<string, unknown> = { scripKey };
  for (const [key, spec] of Object.entries(INDEX_FIELD_MAP)) {
    const value = spec.parse(merged[key]);
    if (value !== undefined) indexTick[spec.publicName] = value;
  }
  const extra = buildExtra(merged, new Set(Object.keys(INDEX_FIELD_MAP)));
  if (extra) indexTick['extra'] = extra;

  return { indexTick: indexTick as unknown as IndexTick, changedFields };
}
