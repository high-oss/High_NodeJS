// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildEntries, SOURCE_PATH } from '../../scripts/generate-index-map.mjs';
import { AMBIGUOUS_INDEX_KEYS, INDEX_FEED_MAP } from '../../src/feed/index-map.generated.js';

describe('the committed index map', () => {
  it('still matches a fresh rebuild from index-feed-map.json', () => {
    const json = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
    const { entries, ambiguous } = buildEntries(json);

    const rebuilt: Record<string, { feedSegment: string; feedSymbol: string }> = {};
    for (const entry of entries) {
      rebuilt[entry.scripKey] = { feedSegment: entry.feedSegment, feedSymbol: entry.feedSymbol };
    }

    expect(rebuilt).toEqual(INDEX_FEED_MAP);

    const rebuiltAmbiguous: Record<string, readonly string[]> = {};
    for (const row of ambiguous) rebuiltAmbiguous[row.scripKey] = row.candidates;
    expect(rebuiltAmbiguous).toEqual(AMBIGUOUS_INDEX_KEYS);
  });

  it('has no overlap between the resolved table and the ambiguous list', () => {
    for (const key of Object.keys(AMBIGUOUS_INDEX_KEYS)) {
      expect(INDEX_FEED_MAP[key], `${key} should not be resolvable`).toBeUndefined();
    }
  });

  it('names every candidate for the ambiguous key used elsewhere in the suite', () => {
    expect(AMBIGUOUS_INDEX_KEYS['NSE@26002']).toEqual(['Nifty FMCG', 'Nifty50 PR 2x Lev']);
  });

  it('known examples resolve as the plan documents', () => {
    expect(INDEX_FEED_MAP['NSE@26000']).toEqual({ feedSegment: 'nse_cm', feedSymbol: 'Nifty 50' });
    expect(INDEX_FEED_MAP['BSE@19000']).toEqual({ feedSegment: 'bse_cm', feedSymbol: 'SENSEX' });
  });

  it('is a non-trivial table', () => {
    expect(Object.keys(INDEX_FEED_MAP).length).toBeGreaterThan(50);
  });
});
