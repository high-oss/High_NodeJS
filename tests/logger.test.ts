// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { createLogger, LOG_LEVELS, redactBody, redactUrl } from '../src/logger.js';

const sink = () => {
  const lines: Array<{ level: string; message: string; detail?: unknown }> = [];
  return {
    lines,
    logger: {
      error: (m: string, d?: unknown) => lines.push({ level: 'error', message: m, detail: d }),
      warn: (m: string, d?: unknown) => lines.push({ level: 'warn', message: m, detail: d }),
      info: (m: string, d?: unknown) => lines.push({ level: 'info', message: m, detail: d }),
      debug: (m: string, d?: unknown) => lines.push({ level: 'debug', message: m, detail: d }),
    },
  };
};

describe('LOG_LEVELS', () => {
  it('orders levels from least to most verbose', () => {
    expect(LOG_LEVELS).toEqual(['silent', 'error', 'warn', 'info', 'debug']);
  });
});

describe('createLogger', () => {
  it('prints nothing at silent, which is the default', () => {
    const { lines, logger } = sink();
    const log = createLogger('silent', logger);
    log.error('boom');
    log.warn('hmm');
    log.info('fyi');
    log.debug('detail');
    expect(lines).toEqual([]);
  });

  it('prints the chosen level and everything more severe', () => {
    const { lines, logger } = sink();
    const log = createLogger('warn', logger);
    log.error('boom');
    log.warn('hmm');
    log.info('fyi');
    log.debug('detail');
    expect(lines.map((l) => l.level)).toEqual(['error', 'warn']);
  });

  it('prints everything at debug', () => {
    const { lines, logger } = sink();
    const log = createLogger('debug', logger);
    log.error('a');
    log.warn('b');
    log.info('c');
    log.debug('d');
    expect(lines.map((l) => l.level)).toEqual(['error', 'warn', 'info', 'debug']);
  });

  it('never evaluates a suppressed level', () => {
    const { logger } = sink();
    const log = createLogger('error', logger);
    expect(log.enabled('debug')).toBe(false);
    expect(log.enabled('error')).toBe(true);
  });

  it('defaults to the console when no logger is supplied', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    createLogger('error').error('boom');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// Credentials must never reach a log sink the caller may ship to a log
// aggregator. This is the whole reason logging goes through one module.
describe('redaction', () => {
  it('redacts the TOTP and credentials from a logged URL', () => {
    const url = 'https://openapi.high.live/v1/auth/generate-access-token?clientId=C1&tOtp=123456';
    const safe = redactUrl(url);
    expect(safe).not.toContain('123456');
    expect(safe).toContain('tOtp=REDACTED');
    expect(safe).toContain('clientId=C1');
  });

  it('redacts every sensitive query parameter it knows', () => {
    const url = 'https://h.example/v1/x?apiKey=k&accessToken=t&tokenId=ti&stepToken=st&consentId=c';
    const safe = redactUrl(url);
    for (const secret of ['=k', '=t&', '=ti', '=st']) expect(safe).not.toContain(secret);
    expect(safe).toContain('consentId=c');
  });

  it('leaves a URL without secrets untouched', () => {
    const url = 'https://openapi.high.live/v1/orders/list';
    expect(redactUrl(url)).toBe(url);
  });

  it('returns a malformed URL unchanged rather than throwing', () => {
    expect(redactUrl('not a url')).toBe('not a url');
  });
});

describe('timestamps', () => {
  it('prefixes every line with an ISO-8601 timestamp and the level', () => {
    const { lines, logger } = sink();
    createLogger('debug', logger).warn('something happened');
    expect(lines[0]!.message).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z WARN {2}something happened$/,
    );
  });

  it('pads the level so lines align in a terminal', () => {
    const { lines, logger } = sink();
    const log = createLogger('debug', logger);
    log.error('a');
    log.debug('b');
    const levels = lines.map((l) => l.message.split('Z ')[1]!.split(' ')[0]);
    expect(levels).toEqual(['ERROR', 'DEBUG']);
    const columns = lines.map((l) => l.message.indexOf(l.message.trim().slice(-1)));
    expect(new Set(columns).size).toBe(1);
  });
});

describe('redactBody', () => {
  it('masks credential-shaped keys at any depth', () => {
    const safe = redactBody({
      tradingSymbol: 'RELIANCE-EQ',
      nested: { accessToken: 'SECRET', tOtp: '123456', apiKey: 'K', password: 'p', pin: '1234' },
    }) as Record<string, Record<string, string>>;
    expect(safe.tradingSymbol).toBe('RELIANCE-EQ');
    for (const key of ['accessToken', 'tOtp', 'apiKey', 'password', 'pin']) {
      expect(safe.nested![key]).toBe('REDACTED');
    }
  });

  it('walks arrays', () => {
    const safe = redactBody([{ tOtp: '1' }, { quantity: 10 }]) as Array<Record<string, unknown>>;
    expect(safe[0]!.tOtp).toBe('REDACTED');
    expect(safe[1]!.quantity).toBe(10);
  });

  it('truncates a large payload rather than filling the log', () => {
    const big = { symbols: Array.from({ length: 500 }, (_, i) => `SYM${i}-EQ`) };
    const safe = JSON.stringify(redactBody(big));
    expect(safe.length).toBeLessThan(2000);
    expect(safe).toContain('truncated');
  });

  it('passes primitives and null through', () => {
    expect(redactBody(undefined)).toBeUndefined();
    expect(redactBody(null)).toBeNull();
    expect(redactBody(42)).toBe(42);
  });
});
