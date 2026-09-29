// Copyright (c) 2026 Truestock
// SPDX-License-Identifier: MIT

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HighClient } from '../src/client.js';
import { HighApiError } from '../src/errors.js';
import { json, startServer, type TestServer } from './server.js';
import { startHttpsServer } from './https-server.js';

const COLUMNS = [
  'exchange', 'segment', 'instrument', 'high_trading_symbol', 'scrip_key', 'isin', 'scrip_code',
  'symbol', 'name', 'group_series', 'has_fno', 'underlying_symbol', 'expiry', 'option_type',
  'strike_price', 'price_tick', 'lot_size',
];

const EQUITY_ROW =
  'NSE,ES,EQUITY,RELIANCE-EQ,NSE@2885,INE002A01018,2885,RELIANCE,' +
  '"Reliance Industries, Ltd",EQ,1,,,,,5,1';
const OPTION_ROW =
  'NSE,FO,OPTSTK,RELIANCE25SEP1400CE,NSE@45231,,45231,RELIANCE,RELIANCE,,0,' +
  'RELIANCE,2026-09-25,CE,1400.5,5,500';

const GOOD_CSV = `${COLUMNS.join(',')}\n${EQUITY_ROW}\n${OPTION_ROW}\n`;

function manifestOf(files: Array<{ instrument: string; url: string }>) {
  return {
    generatedAt: '2026-09-29T02:53:10.000Z',
    columns: COLUMNS,
    files: files.map((f) => ({
      instrument: f.instrument, url: f.url, bytes: GOOD_CSV.length, rows: 2,
      checksum: 'deadbeef', updatedAt: '2026-09-29T02:53:09.000Z',
    })),
  };
}

// The `https`-only rule (Review Focus 3) can only be exercised end-to-end
// against a real TLS server, and nothing this small should ship a CA-signed
// certificate — so tests that need a *successful* download run over a real
// local HTTPS server with a self-signed loopback certificate, with
// certificate verification relaxed process-wide for the duration of this
// file. `fetch` itself is never mocked: every request in this file is a real
// exchange with a real local server.
let previousTlsSetting: string | undefined;
beforeAll(() => {
  previousTlsSetting = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
});
afterAll(() => {
  if (previousTlsSetting === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsSetting;
});

let gateway: TestServer;
let cdn: TestServer;
afterEach(async () => {
  await gateway?.close();
  await cdn?.close();
});

async function setup(
  filesFor: (csvUrl: (category: string) => string) => Array<{ instrument: string; url: string }>,
  csv = GOOD_CSV,
) {
  cdn = await startHttpsServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/csv' });
    res.end(csv);
  });
  const csvUrl = (category: string) => `${cdn.baseUrl}/${category}.csv`;
  const files = filesFor(csvUrl);
  gateway = await startServer((_req, res) => json(res, 200, { requestId: 'r', data: manifestOf(files) }));
  const client = new HighClient({
    baseUrl: gateway.baseUrl,
    apiKey: 'SECRET-KEY',
    accessToken: 'SECRET-TOKEN',
    instrumentsAllowedHosts: ['127.0.0.1'],
  });
  return { client, csvUrl };
}

describe('instruments resource', () => {
  it('streams typed rows: quoted commas kept whole, blanks undefined, price_tick not normalised', async () => {
    const { client } = await setup((csvUrl) => [{ instrument: 'equity', url: csvUrl('equity') }]);

    const rows = [];
    for await (const row of client.instruments.stream('equity')) rows.push(row);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      exchange: 'NSE', segment: 'ES', instrument: 'EQUITY', highTradingSymbol: 'RELIANCE-EQ',
      scripKey: 'NSE@2885', isin: 'INE002A01018', scripCode: 2885, symbol: 'RELIANCE',
      name: 'Reliance Industries, Ltd', groupSeries: 'EQ', hasFno: 1,
      underlyingSymbol: undefined, expiry: undefined, optionType: undefined, strikePrice: undefined,
      priceTick: 5, lotSize: 1,
    });
    expect(rows[1]).toEqual({
      exchange: 'NSE', segment: 'FO', instrument: 'OPTSTK', highTradingSymbol: 'RELIANCE25SEP1400CE',
      scripKey: 'NSE@45231', isin: undefined, scripCode: 45231, symbol: 'RELIANCE', name: 'RELIANCE',
      groupSeries: undefined, hasFno: 0, underlyingSymbol: 'RELIANCE', expiry: '2026-09-25',
      optionType: 'CE', strikePrice: 1400.5,
      // Not normalised: reported exactly as the CSV says, whatever segment-specific scale that is.
      priceTick: 5, lotSize: 500,
    });
  });

  it('list() materialises the same rows eagerly', async () => {
    const { client } = await setup((csvUrl) => [{ instrument: 'equity', url: csvUrl('equity') }]);
    const rows = await client.instruments.list('equity');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.symbol).toBe('RELIANCE');
  });

  it('attaches no credentials to the manifest call or the CSV download', async () => {
    const { client } = await setup((csvUrl) => [{ instrument: 'equity', url: csvUrl('equity') }]);
    await client.instruments.list('equity');

    expect(gateway.requests).toHaveLength(1);
    for (const req of [...gateway.requests, ...cdn.requests]) {
      expect(req.headers.authorization).toBeUndefined();
      expect(req.headers['x-api-key']).toBeUndefined();
    }
  });

  it('caches the manifest for the client, fetching it only once across calls', async () => {
    const { client } = await setup((csvUrl) => [{ instrument: 'equity', url: csvUrl('equity') }]);
    await client.instruments.list('equity');
    await client.instruments.list('equity');
    expect(gateway.requests).toHaveLength(1);
    expect(cdn.requests).toHaveLength(2);
  });

  it('streams rows incrementally rather than buffering the whole body', async () => {
    cdn = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.write(`${COLUMNS.join(',')}\n${EQUITY_ROW}\n`);
      setTimeout(() => res.end(`${OPTION_ROW}\n`), 250).unref();
    });
    gateway = await startServer((_req, res) =>
      json(res, 200, { requestId: 'r', data: manifestOf([{ instrument: 'equity', url: `${cdn.baseUrl}/equity.csv` }]) }));
    const client = new HighClient({
      baseUrl: gateway.baseUrl, accessToken: 'tok', instrumentsAllowedHosts: ['127.0.0.1'],
    });

    const timestamps: number[] = [];
    const startedAt = Date.now();
    for await (const _row of client.instruments.stream('equity')) {
      timestamps.push(Date.now() - startedAt);
    }
    expect(timestamps).toHaveLength(2);
    expect(timestamps[0]).toBeLessThan(150);
    expect(timestamps[1]).toBeGreaterThanOrEqual(200);
  });

  it('a category the manifest does not list is a clear error, not a crash', async () => {
    const { client } = await setup(() => [
      { instrument: 'equity', url: 'https://127.0.0.1/never-called.csv' },
    ]);
    const error = await client.instruments.list('commodity').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/commodity.*not available/i);
    expect(cdn.requests).toHaveLength(0);
  });

  it('ignores an extra category in the manifest that the SDK does not know', async () => {
    const { client } = await setup((csvUrl) => [
      { instrument: 'equity', url: csvUrl('equity') },
      { instrument: 'crypto-perpetuals', url: 'https://127.0.0.1/never-called.csv' },
    ]);
    const rows = await client.instruments.list('equity');
    expect(rows).toHaveLength(2);
  });

  it('refuses a non-https download URL before making any request', async () => {
    const { client } = await setup(() => [{ instrument: 'equity', url: 'http://127.0.0.1/insecure.csv' }]);
    const error = await client.instruments.list('equity').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/https/i);
    expect(cdn.requests).toHaveLength(0);
  });

  it('refuses a download URL whose host is not on the allowlist, before making any request', async () => {
    const { client } = await setup(() => [
      { instrument: 'equity', url: 'https://not-the-real-cdn.example/scrip-master-equity.csv' },
    ]);
    const error = await client.instruments.list('equity').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/not-the-real-cdn\.example/);
    expect(cdn.requests).toHaveLength(0);
  });

  it('defaults instrumentsAllowedHosts to the CDN the manifest normally uses', () => {
    const client = new HighClient({ accessToken: 'tok' });
    expect(client.config.instrumentsAllowedHosts).toContain(
      'high-space.blr1.cdn.digitaloceanspaces.com',
    );
  });

  it('fails loudly on a CSV header that does not match the manifest columns, never shifting fields', async () => {
    const badCsv = 'segment,exchange,instrument\nES,NSE,EQUITY\n'; // swapped + truncated
    const { client } = await setup((csvUrl) => [{ instrument: 'equity', url: csvUrl('equity') }], badCsv);

    const error = await client.instruments.list('equity').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/header does not match/i);
  });

  it('rejects a CSV missing a required column entirely', async () => {
    const csv = 'exchange,segment,instrument,high_trading_symbol,scrip_key,isin,symbol,name,group_series,' +
      'has_fno,underlying_symbol,expiry,option_type,strike_price,price_tick,lot_size\n' +
      'NSE,ES,EQUITY,RELIANCE-EQ,NSE@2885,INE002A01018,RELIANCE,Reliance,EQ,1,,,,,5,1\n';
    const shortColumns = COLUMNS.filter((c) => c !== 'scrip_code');
    cdn = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.end(csv);
    });
    gateway = await startServer((_req, res) => json(res, 200, {
      requestId: 'r',
      data: { generatedAt: '2026-09-29T02:53:10.000Z', columns: shortColumns, files: [{
        instrument: 'equity', url: `${cdn.baseUrl}/equity.csv`, bytes: csv.length, rows: 1,
        checksum: 'x', updatedAt: '2026-09-29T02:53:09.000Z',
      }] },
    }));
    const client = new HighClient({
      baseUrl: gateway.baseUrl, accessToken: 'tok', instrumentsAllowedHosts: ['127.0.0.1'],
    });
    const error = await client.instruments.list('equity').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/scrip_code/);
  });

  it('times out when the CSV body stalls, covering the whole exchange not just the headers', async () => {
    cdn = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.write(`${COLUMNS.join(',')}\n`);
      setTimeout(() => res.end(`${EQUITY_ROW}\n`), 3000).unref();
    });
    gateway = await startServer((_req, res) =>
      json(res, 200, { requestId: 'r', data: manifestOf([{ instrument: 'equity', url: `${cdn.baseUrl}/equity.csv` }]) }));
    const client = new HighClient({
      baseUrl: gateway.baseUrl, accessToken: 'tok', instrumentsAllowedHosts: ['127.0.0.1'],
    });

    const startedAt = Date.now();
    const error = await client.instruments.list('equity', { timeoutMs: 150 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HighApiError);
    expect((error as HighApiError).message).toMatch(/timed out/i);
    expect(Date.now() - startedAt).toBeLessThan(2500);
  });

  it('lets a per-call timeoutMs override rescue a slow download the default would have killed', async () => {
    cdn = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.write(`${COLUMNS.join(',')}\n`);
      setTimeout(() => res.end(`${EQUITY_ROW}\n`), 300).unref();
    });
    gateway = await startServer((_req, res) =>
      json(res, 200, { requestId: 'r', data: manifestOf([{ instrument: 'equity', url: `${cdn.baseUrl}/equity.csv` }]) }));
    const client = new HighClient({
      baseUrl: gateway.baseUrl, accessToken: 'tok', timeoutMs: 100, instrumentsAllowedHosts: ['127.0.0.1'],
    });

    const rows = await client.instruments.list('equity', { timeoutMs: 5000 });
    expect(rows).toHaveLength(1);
  });

  it('surfaces the caller\'s own cancellation unchanged, not as a timeout', async () => {
    cdn = await startHttpsServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/csv' });
      res.write(`${COLUMNS.join(',')}\n`);
      setTimeout(() => res.end(`${EQUITY_ROW}\n`), 3000).unref();
    });
    gateway = await startServer((_req, res) =>
      json(res, 200, { requestId: 'r', data: manifestOf([{ instrument: 'equity', url: `${cdn.baseUrl}/equity.csv` }]) }));
    const client = new HighClient({
      baseUrl: gateway.baseUrl, accessToken: 'tok', timeoutMs: 10_000, instrumentsAllowedHosts: ['127.0.0.1'],
    });

    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('caller cancelled')), 100);
    await expect(client.instruments.list('equity', { signal: controller.signal }))
      .rejects.toThrow(/caller cancelled/);
  });
});
