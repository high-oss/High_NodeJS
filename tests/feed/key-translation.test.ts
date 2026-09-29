// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { feedTopicOf, isIndexKey, translateScripKey } from '../../src/feed/key-translation.js';
import { HighFeedError } from '../../src/feed/errors.js';

describe('translateScripKey', () => {
  it('derives the feed segment from a cash equity key', () => {
    const identity = translateScripKey('NSE@15563');
    expect(identity).toEqual({ feedSegment: 'nse_cm', feedSymbol: '15563', isIndex: false });
    expect(feedTopicOf(identity)).toBe('nse_cm|15563');
  });

  it('derives the feed segment from a BSE cash key', () => {
    expect(translateScripKey('BSE@532540')).toEqual({
      feedSegment: 'bse_cm', feedSymbol: '532540', isIndex: false,
    });
  });

  it('derives nse_fo / bse_fo / mcx_fo from their own prefixes', () => {
    expect(translateScripKey('NSEFO@52190').feedSegment).toBe('nse_fo');
    expect(translateScripKey('BSEFO@842150').feedSegment).toBe('bse_fo');
    expect(translateScripKey('MCXFO@227915').feedSegment).toBe('mcx_fo');
  });

  it('looks the index table up first, so an index key never falls through to the token rule', () => {
    const identity = translateScripKey('NSE@26000');
    expect(identity).toEqual({ feedSegment: 'nse_cm', feedSymbol: 'Nifty 50', isIndex: true });
    expect(feedTopicOf(identity)).toBe('nse_cm|Nifty 50');
    expect(isIndexKey('NSE@26000')).toBe(true);
    expect(isIndexKey('NSE@15563')).toBe(false);
  });

  it('resolves a BSE index by name too', () => {
    expect(translateScripKey('BSE@19000')).toEqual({
      feedSegment: 'bse_cm', feedSymbol: 'SENSEX', isIndex: true,
    });
  });

  it('rejects MCX spot explicitly, naming the key', () => {
    expect(() => translateScripKey('MCX@429440')).toThrow(/MCX@429440.*MCX spot/s);
  });

  it('rejects an unsupported prefix, naming the key and listing what is supported', () => {
    expect(() => translateScripKey('NCDEX@1')).toThrow(/NCDEX@1.*unsupported prefix/s);
    expect(() => translateScripKey('NCDEX@1')).toThrow(/NSE@/);
  });

  it('rejects a key that is not even the right shape', () => {
    expect(() => translateScripKey('not-a-scrip-key')).toThrow(HighFeedError);
    expect(() => translateScripKey('')).toThrow(HighFeedError);
  });

  it('rejects the six scripKeys the scrip master resolves to more than one index, naming every candidate', () => {
    expect(() => translateScripKey('NSE@26002')).toThrow(/NSE@26002/);
    expect(() => translateScripKey('NSE@26002')).toThrow(/Nifty FMCG/);
    expect(() => translateScripKey('NSE@26002')).toThrow(/Nifty50 PR 2x Lev/);
  });
});
