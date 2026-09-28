// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';
import { createLogger, LOG_LEVELS, redactUrl } from '../src/logger.js';

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
