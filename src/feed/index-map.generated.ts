// Copyright (c) 2026 Truestock
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
 * 81 HIGH index scrip keys the datafeed subscribes to by name
 * rather than by token, keyed by the caller's own scrip key. See
 * docs/superpowers/plans/2026-09-29-datafeed-socket.md, Phase 1, for how this
 * table was built and which index rows were deliberately left out.
 */
export const INDEX_FEED_MAP: Readonly<Record<string, IndexFeedEntry>> = {
  "BSE@19000": { feedSegment: "bse_cm", feedSymbol: "SENSEX" },
  "BSE@19001": { feedSegment: "bse_cm", feedSymbol: "BSEPSU" },
  "BSE@19002": { feedSegment: "bse_cm", feedSymbol: "BSE100" },
  "BSE@19003": { feedSegment: "bse_cm", feedSymbol: "BSE200" },
  "BSE@19004": { feedSegment: "bse_cm", feedSymbol: "BSE500" },
  "BSE@19005": { feedSegment: "bse_cm", feedSymbol: "BSE IT" },
  "BSE@19006": { feedSegment: "bse_cm", feedSymbol: "BSEFMC" },
  "BSE@19007": { feedSegment: "bse_cm", feedSymbol: "BSE CG" },
  "BSE@19008": { feedSegment: "bse_cm", feedSymbol: "BSE CD" },
  "BSE@19009": { feedSegment: "bse_cm", feedSymbol: "BSE HC" },
  "BSE@19011": { feedSegment: "bse_cm", feedSymbol: "TECK" },
  "BSE@19012": { feedSegment: "bse_cm", feedSymbol: "BANKEX" },
  "BSE@19013": { feedSegment: "bse_cm", feedSymbol: "AUTO" },
  "BSE@19014": { feedSegment: "bse_cm", feedSymbol: "METAL" },
  "BSE@19015": { feedSegment: "bse_cm", feedSymbol: "CPSE" },
  "BSE@19016": { feedSegment: "bse_cm", feedSymbol: "MIDCAP" },
  "BSE@19017": { feedSegment: "bse_cm", feedSymbol: "SMLCAP" },
  "BSE@19019": { feedSegment: "bse_cm", feedSymbol: "DOL100" },
  "BSE@19020": { feedSegment: "bse_cm", feedSymbol: "DOL200" },
  "BSE@19051": { feedSegment: "bse_cm", feedSymbol: "OILGAS" },
  "BSE@19052": { feedSegment: "bse_cm", feedSymbol: "POWER" },
  "BSE@19053": { feedSegment: "bse_cm", feedSymbol: "REALTY" },
  "BSE@19054": { feedSegment: "bse_cm", feedSymbol: "BSEIPO" },
  "BSE@19059": { feedSegment: "bse_cm", feedSymbol: "SMEIPO" },
  "BSE@19060": { feedSegment: "bse_cm", feedSymbol: "INFRA" },
  "BSE@19089": { feedSegment: "bse_cm", feedSymbol: "LMI250" },
  "BSE@39": { feedSegment: "bse_cm", feedSymbol: "ENERGY" },
  "BSE@40": { feedSegment: "bse_cm", feedSymbol: "FINSER" },
  "BSE@41": { feedSegment: "bse_cm", feedSymbol: "INDSTR" },
  "BSE@42": { feedSegment: "bse_cm", feedSymbol: "LRGCAP" },
  "BSE@43": { feedSegment: "bse_cm", feedSymbol: "MIDSEL" },
  "BSE@44": { feedSegment: "bse_cm", feedSymbol: "SMLSEL" },
  "BSE@45": { feedSegment: "bse_cm", feedSymbol: "TELCOM" },
  "BSE@47": { feedSegment: "bse_cm", feedSymbol: "SNSX50" },
  "BSE@48": { feedSegment: "bse_cm", feedSymbol: "SNXT50" },
  "BSE@55": { feedSegment: "bse_cm", feedSymbol: "MID150" },
  "BSE@58": { feedSegment: "bse_cm", feedSymbol: "MSL400" },
  "NSE@25998": { feedSegment: "nse_cm", feedSymbol: "Nifty 500" },
  "NSE@26000": { feedSegment: "nse_cm", feedSymbol: "Nifty 50" },
  "NSE@26001": { feedSegment: "nse_cm", feedSymbol: "Nifty GrowSect 15" },
  "NSE@26008": { feedSegment: "nse_cm", feedSymbol: "Nifty IT" },
  "NSE@26009": { feedSegment: "nse_cm", feedSymbol: "Nifty Bank" },
  "NSE@26012": { feedSegment: "nse_cm", feedSymbol: "Nifty 100" },
  "NSE@26013": { feedSegment: "nse_cm", feedSymbol: "Nifty Next 50" },
  "NSE@26014": { feedSegment: "nse_cm", feedSymbol: "Nifty Midcap 50" },
  "NSE@26017": { feedSegment: "nse_cm", feedSymbol: "India VIX" },
  "NSE@26018": { feedSegment: "nse_cm", feedSymbol: "Nifty Pharma" },
  "NSE@26019": { feedSegment: "nse_cm", feedSymbol: "Nifty Infra" },
  "NSE@26021": { feedSegment: "nse_cm", feedSymbol: "Nifty Realty" },
  "NSE@26022": { feedSegment: "nse_cm", feedSymbol: "Nifty MNC" },
  "NSE@26024": { feedSegment: "nse_cm", feedSymbol: "Nifty PSE" },
  "NSE@26026": { feedSegment: "nse_cm", feedSymbol: "Nifty Serv Sector" },
  "NSE@26033": { feedSegment: "nse_cm", feedSymbol: "Nifty Auto" },
  "NSE@26035": { feedSegment: "nse_cm", feedSymbol: "Nifty Consumption" },
  "NSE@26036": { feedSegment: "nse_cm", feedSymbol: "Nifty 200" },
  "NSE@26037": { feedSegment: "nse_cm", feedSymbol: "Nifty Fin Service" },
  "NSE@26038": { feedSegment: "nse_cm", feedSymbol: "Nifty50 Div Point" },
  "NSE@26041": { feedSegment: "nse_cm", feedSymbol: "Nifty CPSE" },
  "NSE@26042": { feedSegment: "nse_cm", feedSymbol: "Nifty50 PR 1x Inv" },
  "NSE@26043": { feedSegment: "nse_cm", feedSymbol: "Nifty50 TR 2x Lev" },
  "NSE@26048": { feedSegment: "nse_cm", feedSymbol: "NIFTY100 Qualty30" },
  "NSE@26049": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 8 13Yr" },
  "NSE@26050": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 10Yr" },
  "NSE@26051": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 10Yr Cln" },
  "NSE@26052": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 4 8Yr" },
  "NSE@26053": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 11 15Yr" },
  "NSE@26054": { feedSegment: "nse_cm", feedSymbol: "Nifty GS 15YrPlus" },
  "NSE@26055": { feedSegment: "nse_cm", feedSymbol: "Nifty GS Compsite" },
  "NSE@26056": { feedSegment: "nse_cm", feedSymbol: "NIFTY50 EQL Wgt" },
  "NSE@26057": { feedSegment: "nse_cm", feedSymbol: "NIFTY100 EQL Wgt" },
  "NSE@26058": { feedSegment: "nse_cm", feedSymbol: "NIFTY100 LowVol30" },
  "NSE@26059": { feedSegment: "nse_cm", feedSymbol: "NIFTY Alpha 50" },
  "NSE@26070": { feedSegment: "nse_cm", feedSymbol: "Nifty50 Value 20" },
  "NSE@26074": { feedSegment: "nse_cm", feedSymbol: "NIFTY MID SELECT" },
  "NSE@26076": { feedSegment: "nse_cm", feedSymbol: "Nifty Pvt Bank" },
  "NSE@26085": { feedSegment: "nse_cm", feedSymbol: "Nifty Media" },
  "NSE@26090": { feedSegment: "nse_cm", feedSymbol: "NIFTY MIDCAP 150" },
  "NSE@26091": { feedSegment: "nse_cm", feedSymbol: "NIFTY SMLCAP 50" },
  "NSE@26092": { feedSegment: "nse_cm", feedSymbol: "NIFTY SMLCAP 250" },
  "NSE@26093": { feedSegment: "nse_cm", feedSymbol: "NIFTY MIDSML 400" },
  "NSE@26094": { feedSegment: "nse_cm", feedSymbol: "NIFTY200 QUALTY30" },
};

/**
 * scripKeys the scrip master genuinely resolves to more than one index — one
 * shared token, several different index names — kept OUT of
 * `INDEX_FEED_MAP` on purpose. `translateScripKey` rejects a key found
 * here with an error naming every candidate, rather than picking one and
 * silently streaming the wrong index under the caller's key.
 */
export const AMBIGUOUS_INDEX_KEYS: Readonly<Record<string, readonly string[]>> = {
  "NSE@26002": ["Nifty FMCG", "Nifty50 PR 2x Lev"],
  "NSE@26020": ["Nifty Energy", "Nifty PSU Bank"],
  "NSE@26034": ["Nifty Div Opps 50", "Nifty Metal"],
  "NSE@26040": ["Nifty Commodities", "Nifty100 Liq 15"],
  "NSE@26044": ["NIFTY MIDCAP 100", "Nifty50 TR 1x Inv"],
  "NSE@26046": ["NIFTY SMLCAP 100", "Nifty Mid Liq 15"],
};
