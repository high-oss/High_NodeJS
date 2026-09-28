// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { ERROR_CODES, errorFromResponse, HighApiError } from '../src/errors.js';

describe('HighApiError', () => {
  it('is an Error with a useful name and message', () => {
    const error = new HighApiError('Order rejected', { status: 400, code: 'ORDER_REJECTED' });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('HighApiError');
    expect(error.message).toBe('Order rejected');
    expect(error.status).toBe(400);
    expect(error.code).toBe('ORDER_REJECTED');
  });
});

describe('errorFromResponse', () => {
  it('maps the documented error envelope', () => {
    const error = errorFromResponse(400, {
      requestId: 'a1b2c3',
      code: 'ORDER_REJECTED',
      message: 'Insufficient funds',
    });
    expect(error.status).toBe(400);
    expect(error.code).toBe('ORDER_REJECTED');
    expect(error.requestId).toBe('a1b2c3');
    expect(error.message).toBe('Insufficient funds');
    expect(error.messages).toEqual(['Insufficient funds']);
  });

  // The Error schema's message is `oneOf [string, array]` — validation errors return a list.
  it('keeps every message when the API returns a list', () => {
    const error = errorFromResponse(400, {
      requestId: 'a1b2c3',
      code: 'VALIDATION_ERROR',
      message: ['quantity must be positive', 'price is required'],
    });
    expect(error.messages).toEqual(['quantity must be positive', 'price is required']);
    expect(error.message).toBe('quantity must be positive; price is required');
  });

  // Review Focus 3: an ALB or proxy returns HTML, not JSON.
  it('survives a non-JSON body and still reports the status', () => {
    const error = errorFromResponse(502, undefined, '<html><body>502 Bad Gateway</body></html>');
    expect(error.status).toBe(502);
    expect(error.code).toBeUndefined();
    expect(error.message).toMatch(/502/);
    expect(error).toBeInstanceOf(HighApiError);
  });

  it('falls back to the status when the body carries no message', () => {
    const error = errorFromResponse(500, { requestId: 'a1b2c3' });
    expect(error.message).toMatch(/500/);
    expect(error.requestId).toBe('a1b2c3');
  });

  it('accepts a code outside the documented catalogue', () => {
    const error = errorFromResponse(403, { code: 'DATA_PLAN_REQUIRED', message: 'Upgrade needed' });
    expect(error.code).toBe('DATA_PLAN_REQUIRED');
  });
});

describe('ERROR_CODES', () => {
  it('carries the documented catalogue for callers to compare against', () => {
    expect(ERROR_CODES).toContain('ORDER_REJECTED');
    expect(ERROR_CODES).toContain('VALIDATION_ERROR');
    expect(ERROR_CODES.length).toBeGreaterThan(20);
  });
});
