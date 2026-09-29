// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { classifyAuthFailure, HighFeedAuthError } from '../../src/feed/errors.js';

describe('classifyAuthFailure', () => {
  it('names the one documented malformed-request code (11002)', () => {
    expect(classifyAuthFailure(11002, 'invalid field count')).toBe('malformedRequest');
  });

  it('recognises a missing-data-plan message', () => {
    expect(classifyAuthFailure(40100, 'No active data plan subscription')).toBe('noDataPlan');
    expect(classifyAuthFailure(40100, 'client is not subscribed to any plan')).toBe('noDataPlan');
  });

  it('recognises an invalid or expired token message', () => {
    expect(classifyAuthFailure(40101, 'Invalid token')).toBe('invalidToken');
    expect(classifyAuthFailure(40101, 'Session token expired')).toBe('invalidToken');
  });

  it('falls back to unknown for the documented-but-generic 11001, and for anything unrecognised', () => {
    expect(classifyAuthFailure(11001, 'failed')).toBe('unknown');
    expect(classifyAuthFailure(59999, 'something new')).toBe('unknown');
  });

  it('never invents a reason it cannot support: stCode and msg always survive intact', () => {
    const error = new HighFeedAuthError({ stCode: 59999, msg: 'something new', reason: 'unknown' });
    expect(error.stCode).toBe(59999);
    expect(error.msg).toBe('something new');
    expect(error.message).toContain('59999');
    expect(error.message).toContain('something new');
  });
});
