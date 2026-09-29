// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Everything `HighFeed` refuses to do that is not an auth rejection: bad
 * configuration, a scrip key the translator cannot place, a subscription that
 * would exceed a server-declared limit, calling a method before `connect()`.
 */
export class HighFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HighFeedError';
  }
}

/**
 * Named cases a caller can act on. `malformedRequest` is the one stCode the
 * apiDoc documents (11002); `noDataPlan` and `invalidToken` are recognised
 * from the ack's own message text (see {@link classifyAuthFailure}) because
 * the gateway's exact codes for those two cases are not yet published.
 * `unknown` covers everything else, including the documented-but-generic
 * 11001 ("failed") — `stCode` and `msg` are always preserved, so nothing is
 * flattened away even when the reason cannot be named.
 */
export type FeedAuthFailureReason = 'noDataPlan' | 'invalidToken' | 'malformedRequest' | 'unknown';

export interface HighFeedAuthErrorInit {
  stCode: number;
  msg: string;
  reason: FeedAuthFailureReason;
}

/**
 * The `cn` acknowledgement came back `"stat":"NotOk"`. This is a gate, not a
 * transport hiccup: `HighFeed` never retries or reconnects after this — the
 * server told it, in-band, that it is going to keep refusing.
 */
export class HighFeedAuthError extends Error {
  readonly stCode: number;
  readonly msg: string;
  readonly reason: FeedAuthFailureReason;

  constructor(init: HighFeedAuthErrorInit) {
    super(`HIGH datafeed authentication was refused (stCode ${init.stCode}): ${init.msg}`);
    this.name = 'HighFeedAuthError';
    this.stCode = init.stCode;
    this.msg = init.msg;
    this.reason = init.reason;
  }
}

/** The one stCode the apiDoc documents for a `cn` rejection besides the generic "failed". */
const KNOWN_ST_CODES: Readonly<Record<number, FeedAuthFailureReason>> = {
  11002: 'malformedRequest',
};

/**
 * Classifies a `NotOk` auth ack. Only 11001 ("failed") and 11002 ("invalid
 * field count") are documented by the apiDoc; the exact stCode for a missing
 * data-plan subscription or an invalid/expired token is not yet known (see
 * the datafeed-socket plan, Phase 0's open question). Until it is, those two
 * cases are recognised defensively from the ack's own `msg` text rather than
 * left unnamed — a caller can `catch` on `reason` today, and a future stCode
 * mapping can replace this without changing that surface. Anything that
 * matches neither pattern surfaces as `unknown`, with `stCode` and `msg`
 * intact — never swallowed, never guessed into the wrong bucket.
 */
export function classifyAuthFailure(stCode: number, msg: string): FeedAuthFailureReason {
  const known = KNOWN_ST_CODES[stCode];
  if (known) return known;

  const text = msg.toLowerCase();
  if (/data\s*plan|not\s*subscribed|subscription/.test(text)) return 'noDataPlan';
  if (/token/.test(text) && /invalid|expired/.test(text)) return 'invalidToken';
  return 'unknown';
}
