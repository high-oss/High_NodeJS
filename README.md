# @high/openapi

Official Node.js SDK for the [HIGH Open API](https://openapi.high.live). Typed
against the canonical OpenAPI contract, with no runtime dependencies.

## Install

```bash
npm install @high/openapi
```

Node 20 or newer. The SDK uses the global `fetch`, so there is nothing to polyfill.

## Quickstart

```ts
import { HighClient } from '@high/openapi';

const high = new HighClient({
  environment: 'sandbox',        // or 'production' (the default)
  apiKey: process.env.HIGH_API_KEY,
  accessToken: process.env.HIGH_ACCESS_TOKEN,
});

const funds = await high.portfolio.funds();
console.log(funds.availableBalance);
```

## Configuration

| Option | Default | Notes |
|---|---|---|
| `environment` | `production` | `production` or `sandbox` |
| `baseUrl` | from `environment` | Overrides the REST host |
| `wsBaseUrl` | from `environment` | Datafeed socket host, reserved for the feed client |
| `versionPath` | `v1` | The segment between host and operation path |
| `apiKey` | `HIGH_API_KEY` | Sent as `x-api-key`, for `auth.generateAccessToken` |
| `accessToken` | `HIGH_ACCESS_TOKEN` | Sent as `Authorization: Bearer` |
| `timeoutMs` | `30000` | Per request |
| `maxRetries` | `2` | Idempotent reads only |
| `maxRetryDelayMs` | `30000` | Ceiling on one retry delay; a longer `Retry-After` fails fast |
| `logLevel` | `silent` | `silent`, `error`, `warn`, `info`, `debug` |
| `logSink` | `console` | Where log lines go |
| `userAgent` | — | Appended to the SDK's own |
| `fetch` | global `fetch` | Transport override |
| `instrumentsAllowedHosts` | the CDN HIGH publishes from | Hosts `instruments` may download from |

Host resolution order: explicit `baseUrl`, then explicit `environment`, then
`HIGH_BASE_URL`, then `HIGH_ENVIRONMENT`, then production. An unknown
environment throws at construction, naming the valid values — never at request
time.

Sandbox and production issue **separate API keys**. Switching environment means
switching credentials too; the SDK does not rewrite them for you.

## Authentication

The SDK covers the **TOTP flow**, which is one call:

```ts
const high = new HighClient({ apiKey: process.env.HIGH_API_KEY });

const { accessToken, expiresAt } = await high.auth.generateAccessToken({
  clientId: 'C1',
  tOtp: '123456',
});

// Use it for everything else.
const trading = new HighClient({ accessToken });
```

A HIGH access token lasts 24 hours. The SDK attaches whatever you give it and
**does not refresh** — minting the next one needs a fresh TOTP, so the timing is
yours to choose. Configuration is settled at construction, so a new token means
a new client.

### What this SDK does not do

It wraps the TOTP endpoint and nothing else from the auth area. The redirect
consent flow and token introspection are not part of the SDK; if you need them,
call those endpoints directly.

## Errors

Every failure is a `HighApiError`, including timeouts and transport failures
(which carry `status: 0`). No raw `fetch` rejection and no JSON `SyntaxError`
escapes the SDK.

```ts
import { HighApiError } from '@high/openapi';

try {
  await high.orders.place(order);
} catch (error) {
  if (error instanceof HighApiError) {
    error.status;     // HTTP status, or 0 for transport failures
    error.code;       // e.g. 'ORDER_REJECTED' — see ERROR_CODES
    error.requestId;  // quote this in support tickets
    error.messages;   // validation errors return several
    error.body;       // the parsed payload, for a non-standard error
  }
}
```

`ERROR_CODES` holds the documented catalogue. The gateway can return codes
outside it, so `code` is a plain string — compare against the constants, but do
not assume the set is closed.

## Retries

Retried: `GET` and `HEAD` only, on 429, 500, 502, 503 and 504, honouring
`Retry-After` in both its seconds and HTTP-date forms, with exponential backoff
otherwise. A `Retry-After` longer than `maxRetryDelayMs` (30s by default) is not
waited out — the SDK gives up and throws, rather than blocking your call inside
an `await` you cannot break out of.

Never retried: `POST`, `PATCH` and `DELETE`. A retried `orders.place` would be
a duplicate order, and a retried square-off would be a second square-off.

## Logging

Off by default. Each level prints itself and everything more severe.

```ts
const high = new HighClient({ accessToken, logLevel: 'debug' });
// 2026-09-28T17:05:12.345Z DEBUG HIGH -> POST https://openapi.high.live/v1/orders
//   { body: { tradeSide: 'B', tradingSymbol: 'RELIANCE-EQ', quantity: 1, … } }
// 2026-09-28T17:05:12.488Z DEBUG HIGH <- 200 in 143ms https://openapi.high.live/v1/orders
//   { requestId: 'a1b2c3', body: { orderId: '2609250000123456', error: '' } }
```

| Level | What it prints |
|---|---|
| `error` | API error responses (status, code, requestId), timeouts, transport failures |
| `warn` | Each retry, and giving up when `Retry-After` exceeds the ceiling |
| `info` | One line per request: method and URL |
| `debug` | The above plus request and response bodies, and response timing |

Every line is prefixed with an ISO-8601 timestamp and the level.

Credentials never reach the log. Headers are not logged at all, and the
`tOtp`, `apiKey`, `accessToken`, `tokenId` and `stepToken` query parameters are
replaced with `REDACTED` — so debug logs are safe to ship to an aggregator.
Pass `logSink` to route lines somewhere other than the console.

## Cancellation

Every method takes an optional `AbortSignal` as its last argument. Your abort is
surfaced unchanged — never converted into a timeout, and never retried.

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);
await high.scrips.quotes({ symbols: ['RELIANCE-EQ'] }, controller.signal);
```

## Resources

24 operations across five authenticated namespaces, plus the credential-free
instrument list.

| Namespace | Methods |
|---|---|
| `auth` | `generateAccessToken` |
| `orders` | `place` · `modify` · `get` · `cancel` · `list` · `trades` · `tradesFor` · `charges` · `margin` |
| `portfolio` | `positions` · `holdings` · `funds` · `convertPosition` · `exitAllPositions` · `exitPosition` |
| `scrips` | `quotes` · `ohlc` · `depth` · `expiries` · `futureData` · `historical` · `optionChain` |
| `market` | `status` |
| `instruments` | `stream` · `list` |

Each method returns the response's `data` — the `{requestId, data}` envelope is
unwrapped for you, and `requestId` reaches you on the error.

A few shapes worth knowing, because they are not what you might guess:

```ts
// quotes and ohlc return a MAP keyed by trading symbol, not an array
const quotes = await high.scrips.quotes({ symbols: ['RELIANCE-EQ'] });
quotes['RELIANCE-EQ']?.LTP;

// historical returns COLUMNAR arrays — index i across them is one candle
const c = await high.scrips.historical({
  tradingSymbol: 'RELIANCE-EQ',
  interval: '1D',
  fromTime: 1789929000,   // epoch seconds
  toTime: 1790330400,
});
c.close[0];               // not c[0].close

// positions and holdings both have `snapshot`, with different shapes
(await high.portfolio.positions()).snapshot.totalPL;
(await high.portfolio.holdings()).snapshot.investment;
```

### Instrument list

The scrip master — every instrument HIGH knows, as a CSV — in five categories:
`all`, `equity`, `derivatives`, `commodity`, `etfs`. It needs no `apiKey` and no
`accessToken`; it is public data, so `instruments` works on a client built with
no credentials at all.

`stream` is the primary form — an `AsyncIterable` that parses rows as they
arrive rather than holding the whole file in memory. `all` and `derivatives`
are tens of megabytes; prefer `stream` for those. `list` materialises an array
and suits the smaller categories.

```ts
for await (const row of high.instruments.stream('equity')) {
  console.log(row.highTradingSymbol, row.symbol, row.lotSize);
}

const commodities = await high.instruments.list('commodity');
```

Every row has these 17 fields. Blank cells come through as `undefined`, never
an empty string:

| Field | Type | Notes |
|---|---|---|
| `exchange` | `string` | |
| `segment` | `string` | |
| `instrument` | `string` | The scrip's own type (e.g. equity, future, option) |
| `highTradingSymbol` | `string` | |
| `scripKey` | `string` | |
| `isin` | `string?` | Equity only |
| `scripCode` | `number` | Integer, broker-assigned |
| `symbol` | `string` | |
| `name` | `string` | May contain commas — parsed properly, not by splitting on `,` |
| `groupSeries` | `string?` | |
| `hasFno` | `number` | `1` or `0` |
| `underlyingSymbol` | `string?` | Derivatives only |
| `expiry` | `string?` | Derivatives only, left as the CSV's own date string |
| `optionType` | `string?` | Options only |
| `strikePrice` | `number?` | Options only |
| `priceTick` | `number` | Integer. Its scale is segment-specific — never rescaled by the SDK |
| `lotSize` | `number` | Integer |

These files are rebuilt once each trading morning and do not change intraday —
cache the result yourself rather than calling this on every request. `all` and
`derivatives` are large downloads (tens of megabytes), so give a call more time
if your connection or your own row processing needs it:

```ts
const rows = await high.instruments.list('all', { timeoutMs: 120_000 });
```

## Live datafeed

No socket client ships in this release. `wsBaseUrl` is resolved and exposed on
the config, but nothing consumes it yet.

## Regenerating from the spec

Types come from the canonical spec at the commit pinned in `spec.lock.json`.

```bash
npm run regenerate   # rewrites generated/ from that commit
```

`generated/` is committed and never hand-edited. To move to a newer contract,
update `spec.lock.json`, regenerate, and commit both.

## Development

```bash
npm test        # vitest
npm run check   # typecheck + test + build
```

Tests run against a real local HTTP server rather than a mocked `fetch`, so a
change in how requests are built is caught rather than asserted around.

## Licence

MIT. See [LICENSE](./LICENSE).
