// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { pathOf } from '../src/paths.js';

// Review Focus 5.
describe('pathOf', () => {
  it('interpolates a plain parameter', () => {
    expect(pathOf('/orders/{orderId}', { orderId: '2609250000123456' }))
      .toBe('/orders/2609250000123456');
  });

  it('encodes characters that would otherwise change the path', () => {
    expect(pathOf('/scrips/{symbol}/depth', { symbol: 'M&M-EQ' }))
      .toBe('/scrips/M%26M-EQ/depth');
    expect(pathOf('/scrips/{symbol}/depth', { symbol: 'NIFTY 50' }))
      .toBe('/scrips/NIFTY%2050/depth');
  });

  it('encodes a slash so a parameter can never add a path segment', () => {
    expect(pathOf('/scrips/{symbol}/depth', { symbol: 'a/../b' }))
      .toBe('/scrips/a%2F..%2Fb/depth');
  });

  it('interpolates several parameters', () => {
    expect(pathOf('/scrips/{symbol}/{type}/expiries', { symbol: 'NIFTY', type: 'OPT' }))
      .toBe('/scrips/NIFTY/OPT/expiries');
  });

  it('accepts a numeric parameter', () => {
    expect(pathOf('/orders/{orderId}', { orderId: 42 })).toBe('/orders/42');
  });

  it('refuses a template whose parameter was not supplied', () => {
    expect(() => pathOf('/orders/{orderId}', {})).toThrow(/orderId/);
  });
});
