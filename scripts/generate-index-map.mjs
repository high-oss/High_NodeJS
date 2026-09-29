// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

/**
 * Renders `src/feed/index-feed-map.json` — a committed copy of the shared,
 * cross-SDK index table described in
 * `docs/superpowers/plans/2026-09-29-datafeed-socket.md` (Phase 1) — into
 * `src/feed/index-map.generated.ts`.
 *
 * The datafeed subscribes to indices by name, not by token, and the mapping
 * from a HIGH scrip key to the feed's own segment/name pair is frozen at
 * build time rather than looked up over the network. This script is the only
 * place that reads the JSON; `tests/feed/index-map.test.ts` reruns it in
 * memory and asserts the committed `.ts` module still agrees with it, so an
 * upstream change shows up as a failing test rather than a silent gap.
 *
 * The source is an object, not a flat array, because the scrip master
 * genuinely has scripKeys that resolve to more than one index (one shared
 * token, two different index names — a real defect, not a typo):
 *
 *   { "indices": [{scripKey, feedSegment, feedSymbol, name}, ...],
 *     "ambiguous": [{scripKey, candidates: [name, name, ...]}, ...] }
 *
 * `indices` renders into `INDEX_FEED_MAP`. `ambiguous` renders into
 * `AMBIGUOUS_INDEX_KEYS`, kept OUT of the lookup table on purpose:
 * `translateScripKey` rejects a scripKey found there with an error naming
 * every candidate, rather than picking one and silently streaming the wrong
 * index under the caller's key.
 *
 * Usage: `node scripts/generate-index-map.mjs` (also run via `npm run
 * regenerate:index-map`). Do not hand-edit `index-map.generated.ts`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SOURCE_PATH = `${ROOT}/src/feed/index-feed-map.json`;
export const OUTPUT_PATH = `${ROOT}/src/feed/index-map.generated.ts`;

/** The only segments the committed source is allowed to use for an index. */
const KNOWN_INDEX_SEGMENTS = new Set(['nse_cm', 'bse_cm']);

function validateIndexRow(row) {
  const { scripKey, feedSegment, feedSymbol } = row ?? {};
  if (typeof scripKey !== 'string' || scripKey === '') {
    throw new Error(`Row in "indices" is missing a string "scripKey": ${JSON.stringify(row)}`);
  }
  if (!KNOWN_INDEX_SEGMENTS.has(feedSegment)) {
    throw new Error(
      `Row for "${scripKey}" has an unrecognised feedSegment "${feedSegment}" — expected one of ` +
        `${[...KNOWN_INDEX_SEGMENTS].join(', ')}.`,
    );
  }
  if (typeof feedSymbol !== 'string' || feedSymbol === '') {
    throw new Error(`Row for "${scripKey}" is missing a string "feedSymbol".`);
  }
  return { scripKey, feedSegment, feedSymbol };
}

function validateAmbiguousRow(row) {
  const { scripKey, candidates } = row ?? {};
  if (typeof scripKey !== 'string' || scripKey === '') {
    throw new Error(`Row in "ambiguous" is missing a string "scripKey": ${JSON.stringify(row)}`);
  }
  if (!Array.isArray(candidates) || candidates.length < 2 || !candidates.every((c) => typeof c === 'string' && c !== '')) {
    throw new Error(`Row for "${scripKey}" in "ambiguous" must carry >= 2 non-empty string candidates.`);
  }
  return { scripKey, candidates };
}

/**
 * Validates the source object's shape and cross-checks the two lists: a
 * scripKey must appear in exactly one of `indices` / `ambiguous`, and neither
 * list may repeat a scripKey against itself. Throws on anything malformed,
 * rather than silently emitting a bad or overlapping entry.
 */
export function buildEntries(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error(
      'index-feed-map.json must be an object with "indices" and "ambiguous" arrays (not a flat array).',
    );
  }
  if (!Array.isArray(source.indices) || !Array.isArray(source.ambiguous)) {
    throw new Error('index-feed-map.json must have array-valued "indices" and "ambiguous" fields.');
  }

  const entries = source.indices.map(validateIndexRow);
  const ambiguous = source.ambiguous.map(validateAmbiguousRow);

  const seen = new Set();
  for (const entry of entries) {
    if (seen.has(entry.scripKey)) {
      throw new Error(`Duplicate scripKey "${entry.scripKey}" within "indices" — an unresolved duplicate belongs under "ambiguous" instead.`);
    }
    seen.add(entry.scripKey);
  }
  for (const row of ambiguous) {
    if (seen.has(row.scripKey)) {
      throw new Error(`"${row.scripKey}" appears in both "indices" and "ambiguous" — it must be in exactly one.`);
    }
  }
  const ambiguousSeen = new Set();
  for (const row of ambiguous) {
    if (ambiguousSeen.has(row.scripKey)) {
      throw new Error(`Duplicate scripKey "${row.scripKey}" within "ambiguous".`);
    }
    ambiguousSeen.add(row.scripKey);
  }

  entries.sort((a, b) => (a.scripKey < b.scripKey ? -1 : 1));
  ambiguous.sort((a, b) => (a.scripKey < b.scripKey ? -1 : 1));
  return { entries, ambiguous };
}

/** Renders the entries into the committed module's exact source text. */
export function renderModule(entries, ambiguous) {
  const rows = entries
    .map(
      (e) =>
        `  ${JSON.stringify(e.scripKey)}: { feedSegment: ${JSON.stringify(e.feedSegment)}, feedSymbol: ${JSON.stringify(e.feedSymbol)} },`,
    )
    .join('\n');

  const ambiguousRows = ambiguous
    .map((a) => `  ${JSON.stringify(a.scripKey)}: [${a.candidates.map((c) => JSON.stringify(c)).join(', ')}],`)
    .join('\n');

  return `// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

// GENERATED FILE — do not hand-edit.
// Rendered from index-feed-map.json by scripts/generate-index-map.mjs.
// Regenerate: node scripts/generate-index-map.mjs
// tests/feed/index-map.test.ts asserts this module still matches the source.

/** One index's identity on the feed: which segment carries it, and its feed-native name. */
export interface IndexFeedEntry {
  readonly feedSegment: 'nse_cm' | 'bse_cm';
  readonly feedSymbol: string;
}

/**
 * ${entries.length} HIGH index scrip keys the datafeed subscribes to by name
 * rather than by token, keyed by the caller's own scrip key. See
 * docs/superpowers/plans/2026-09-29-datafeed-socket.md, Phase 1, for how this
 * table was built and which index rows were deliberately left out.
 */
export const INDEX_FEED_MAP: Readonly<Record<string, IndexFeedEntry>> = {
${rows}
};

/**
 * scripKeys the scrip master genuinely resolves to more than one index — one
 * shared token, several different index names — kept OUT of
 * \`INDEX_FEED_MAP\` on purpose. \`translateScripKey\` rejects a key found
 * here with an error naming every candidate, rather than picking one and
 * silently streaming the wrong index under the caller's key.
 */
export const AMBIGUOUS_INDEX_KEYS: Readonly<Record<string, readonly string[]>> = {
${ambiguousRows}
};
`;
}

function main() {
  const json = JSON.parse(readFileSync(SOURCE_PATH, 'utf8'));
  const { entries, ambiguous } = buildEntries(json);
  writeFileSync(OUTPUT_PATH, renderModule(entries, ambiguous));
  console.log(`Wrote ${entries.length} index entries and ${ambiguous.length} ambiguous keys to ${OUTPUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
