// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

export const SOURCE_PATH: string;
export const OUTPUT_PATH: string;

export interface IndexMapEntry {
  readonly scripKey: string;
  readonly feedSegment: 'nse_cm' | 'bse_cm';
  readonly feedSymbol: string;
}

export interface AmbiguousIndexRow {
  readonly scripKey: string;
  readonly candidates: readonly string[];
}

export interface IndexMapSource {
  readonly indices: readonly unknown[];
  readonly ambiguous: readonly unknown[];
}

export function buildEntries(
  source: IndexMapSource,
): { entries: IndexMapEntry[]; ambiguous: AmbiguousIndexRow[] };

export function renderModule(
  entries: readonly IndexMapEntry[],
  ambiguous: readonly AmbiguousIndexRow[],
): string;
