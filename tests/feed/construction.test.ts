// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { HighFeed } from '../../src/feed/feed.js';
import { HighFeedError } from '../../src/feed/errors.js';

describe('HighFeed construction', () => {
  it('is production-only: a sandbox-configured client refuses construction outright', () => {
    expect(() => new HighFeed({ environment: 'sandbox', accessToken: 'tok' })).toThrow(HighFeedError);
    expect(() => new HighFeed({ environment: 'sandbox', accessToken: 'tok' })).toThrow(/sandbox/i);
  });

  it('never even reaches a socket attempt for sandbox — the throw happens synchronously at construction', () => {
    let threw = false;
    try {
      new HighFeed({ environment: 'sandbox', accessToken: 'tok' });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it('defaults to production and constructs fine with no environment given', () => {
    expect(() => new HighFeed({ accessToken: 'tok' })).not.toThrow();
  });

  it('constructs fine with an explicit production environment', () => {
    expect(() => new HighFeed({ environment: 'production', accessToken: 'tok' })).not.toThrow();
  });

  it('rejects connect() before any socket work when no accessToken is configured', async () => {
    const feed = new HighFeed({ wsBaseUrl: 'ws://127.0.0.1:1' });
    await expect(feed.connect()).rejects.toThrow(/accessToken/);
  });
});
