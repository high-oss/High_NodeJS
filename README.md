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
| `logLevel` | `silent` | `silent`, `error`, `warn`, `info`, `debug` |
| `logSink` | `console` | Where log lines go |
| `userAgent` | — | Appended to the SDK's own |
| `fetch` | global `fetch` | Transport override |

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

### The redirect consent flow is not wrapped

If your application signs in *other people's* HIGH accounts, you use the
redirect consent flow instead. It is built around a browser page only a human
can complete, so this SDK wraps none of it. Call the three endpoints directly:

```
1. GET  {baseUrl}/{versionPath}/auth/generate-consent?clientId=…
        header: x-api-key                    → { consentId }

2.      Redirect the user's browser to
        {baseUrl}/{versionPath}/auth/login?consentId=…
        HIGH hosts this page. On success it redirects the browser to the
        redirect URL registered against your API key, with tokenId appended.

3. GET  {baseUrl}/{versionPath}/auth/consume-consent?tokenId=…
        header: x-api-key                    → { accessToken, expiresAt }
```

Pass the resulting `accessToken` to `new HighClient({ accessToken })` and use
the SDK for everything that follows.

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
  }
}
```

`ERROR_CODES` holds the documented catalogue. The gateway can return codes
outside it, so `code` is a plain string — compare against the constants, but do
not assume the set is closed.

## Retries

Retried: `GET` only, on 429 and 5xx, honouring `Retry-After` in both its
seconds and HTTP-date forms, with exponential backoff otherwise.

Never retried: `POST`, `PATCH` and `DELETE`. A retried `orders.place` would be
a duplicate order, and a retried square-off would be a second square-off.

## Logging

Off by default. Each level prints itself and everything more severe.

```ts
const high = new HighClient({ accessToken, logLevel: 'debug' });
// HIGH -> GET https://openapi.high.live/v1/orders/list
// HIGH <- 200 in 143ms https://openapi.high.live/v1/orders/list { requestId: 'a1b2c3' }
```

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

24 operations across five namespaces.

| Namespace | Methods |
|---|---|
| `auth` | `generateAccessToken` |
| `orders` | `place` · `modify` · `get` · `cancel` · `list` · `trades` · `tradesFor` · `charges` · `margin` |
| `portfolio` | `positions` · `holdings` · `funds` · `convertPosition` · `exitAllPositions` · `exitPosition` |
| `scrips` | `quotes` · `ohlc` · `depth` · `expiries` · `futureData` · `historical` · `optionChain` |
| `market` | `status` |

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

## Live datafeed

Not in this release. When the datafeed socket ships it arrives as a separate
`HighFeed` client alongside `HighClient`, reusing the same configuration and
credentials. `ENVIRONMENTS` already carries the socket host per environment.

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
