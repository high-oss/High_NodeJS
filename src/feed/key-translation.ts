// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { HighFeedError } from './errors.js';
import { AMBIGUOUS_INDEX_KEYS, INDEX_FEED_MAP } from './index-map.generated.js';

/** The feed segments the SDK knows how to reach. Never widened by a fallback. */
export type FeedSegment = 'nse_cm' | 'bse_cm' | 'nse_fo' | 'bse_fo' | 'mcx_fo';

/**
 * Closed map from a HIGH scrip key's own prefix to the feed segment it
 * becomes. `MCX@` (spot) is deliberately absent — see the plan's segment-map
 * table — so it falls through to the "unsupported prefix" error below rather
 * than silently going unmatched with a worse message.
 */
const PREFIX_SEGMENTS: Readonly<Record<string, FeedSegment>> = {
  NSE: 'nse_cm',
  BSE: 'bse_cm',
  NSEFO: 'nse_fo',
  BSEFO: 'bse_fo',
  MCXFO: 'mcx_fo',
};

const KEY_PATTERN = /^([A-Z]+)@(.+)$/;

export interface FeedIdentity {
  readonly feedSegment: FeedSegment;
  /** The feed's own instrument identifier: a token for cash/derivative scrips, a name for indices. */
  readonly feedSymbol: string;
  readonly isIndex: boolean;
}

function supportedPrefixes(): string {
  return Object.keys(PREFIX_SEGMENTS)
    .map((prefix) => `${prefix}@`)
    .join(', ');
}

/**
 * Translates one HIGH scrip key into the feed's own identity.
 *
 * The index table is checked **first**: indices share the `NSE@`/`BSE@`
 * prefix with cash scrips, so a key that matches an index is never allowed to
 * fall through to the token-based prefix rule below, which would silently
 * treat a known index as an ordinary cash token and never tick.
 *
 * Never guesses. An unrecognised prefix, MCX spot, an index absent from the
 * committed table, or a scripKey the source data cannot place unambiguously
 * (see {@link AMBIGUOUS_INDEX_KEYS}) all throw a {@link HighFeedError} naming
 * the key — never passed through, never dropped silently.
 */
export function translateScripKey(scripKey: string): FeedIdentity {
  const candidates = AMBIGUOUS_INDEX_KEYS[scripKey];
  if (candidates) {
    throw new HighFeedError(
      `"${scripKey}" resolves to more than one index in the scrip master (${candidates.join(', ')}) — ` +
        `refusing to guess which one you mean. This is a data defect upstream, not something the SDK ` +
        `can pick a side on; it will start working once the scrip master is corrected.`,
    );
  }

  const indexed = INDEX_FEED_MAP[scripKey];
  if (indexed) {
    return { feedSegment: indexed.feedSegment, feedSymbol: indexed.feedSymbol, isIndex: true };
  }

  const match = KEY_PATTERN.exec(scripKey);
  if (!match) {
    throw new HighFeedError(
      `"${scripKey}" is not a HIGH scrip key the datafeed can subscribe to — expected the form ` +
        `"PREFIX@identifier" (e.g. "NSE@15563").`,
    );
  }
  const prefix = match[1]!;
  const rest = match[2]!;

  if (prefix === 'MCX') {
    throw new HighFeedError(
      `"${scripKey}" is an MCX spot key — the datafeed has no known feed code for MCX spot. ` +
        `Supported prefixes: ${supportedPrefixes()}.`,
    );
  }

  const feedSegment = PREFIX_SEGMENTS[prefix];
  if (!feedSegment) {
    throw new HighFeedError(
      `"${scripKey}" has an unsupported prefix "${prefix}@". Supported prefixes: ${supportedPrefixes()}.`,
    );
  }

  return { feedSegment, feedSymbol: rest, isIndex: false };
}

/** `true` for any of the 81 committed index keys — including none of the 6 ambiguous ones. */
export function isIndexKey(scripKey: string): boolean {
  return scripKey in INDEX_FEED_MAP;
}

/** The wire topic string the feed itself uses: `<segment>|<symbol>`. */
export function feedTopicOf(identity: FeedIdentity): string {
  return `${identity.feedSegment}|${identity.feedSymbol}`;
}
