// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { CsvRowSplitter } from '../src/csv.js';

function parseAll(chunks: string[]): string[][] {
  const splitter = new CsvRowSplitter();
  const rows: string[][] = [];
  for (const chunk of chunks) rows.push(...splitter.push(chunk));
  rows.push(...splitter.finish());
  return rows;
}

describe('CsvRowSplitter', () => {
  it('splits plain comma-separated rows', () => {
    expect(parseAll(['a,b,c\nd,e,f\n'])).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('does not shift fields when a quoted value contains a comma', () => {
    expect(parseAll(['NSE,"Reliance Industries, Ltd",2885\n'])).toEqual([
      ['NSE', 'Reliance Industries, Ltd', '2885'],
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseAll(['a,"say ""hi""",c\n'])).toEqual([['a', 'say "hi"', 'c']]);
  });

  it('keeps a plain quote-free field with an embedded quote-like character untouched', () => {
    expect(parseAll(['a,b"c,d\n'])).toEqual([['a', 'b"c', 'd']]);
  });

  it('handles a quoted field split across two chunks', () => {
    expect(parseAll(['a,"partial', ' value",c\n'])).toEqual([['a', 'partial value', 'c']]);
  });

  it('handles an escaped quote split exactly at the chunk boundary', () => {
    // The pair of quotes that escapes to a literal `"` is split so the first
    // quote is the last character of one chunk and the second quote is the
    // first character of the next — the splitter must not resolve the first
    // quote as a closing quote before it sees what follows.
    expect(parseAll(['a,"x"', '"y",c\n'])).toEqual([['a', 'x"y', 'c']]);
  });

  it('treats a lone chunk-boundary quote as closing when the next char is not a quote', () => {
    expect(parseAll(['a,"done"', ',next\n'])).toEqual([['a', 'done', 'next']]);
  });

  it('ignores a carriage return before a line feed', () => {
    expect(parseAll(['a,b\r\nc,d\r\n'])).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('captures the final row when the input has no trailing newline', () => {
    expect(parseAll(['a,b,c'])).toEqual([['a', 'b', 'c']]);
  });

  it('captures a trailing empty field before an unterminated end of input', () => {
    expect(parseAll(['a,b,'])).toEqual([['a', 'b', '']]);
  });

  it('produces nothing for empty input', () => {
    expect(parseAll([''])).toEqual([]);
    expect(parseAll([])).toEqual([]);
  });

  it('parses a realistic instrument row', () => {
    const row =
      'NSE,ES,EQUITY,RELIANCE-EQ,NSE@2885,INE002A01018,2885,RELIANCE,' +
      '"Reliance Industries, Ltd",EQ,1,,,,,5,1\n';
    expect(parseAll([row])).toEqual([
      [
        'NSE', 'ES', 'EQUITY', 'RELIANCE-EQ', 'NSE@2885', 'INE002A01018', '2885', 'RELIANCE',
        'Reliance Industries, Ltd', 'EQ', '1', '', '', '', '', '5', '1',
      ],
    ]);
  });
});
