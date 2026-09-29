# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] — 2026-09-28

First release. Pre-1.0: the surface may still change.

### Added

- `HighClient` covering 24 of the 27 HIGH Open API operations across five
  namespaces: `auth`, `orders`, `portfolio`, `scrips` and `market`.
- `instruments.stream` and `instruments.list`, covering the instrument list —
  17 typed fields, five categories (`all`, `equity`, `derivatives`,
  `commodity`, `etfs`), no credentials required. `stream` parses rows as they
  arrive rather than buffering the whole file; `instrumentsAllowedHosts`
  configures which hosts the SDK will download from.
- Types generated from the canonical OpenAPI contract, pinned by commit in
  `spec.lock.json` and regenerated with `npm run regenerate`.
- Configuration by `environment` (`production` / `sandbox`) or explicit
  `baseUrl`, with an independently settable `versionPath`, and environment
  variable fallbacks. An unknown environment or a bad numeric option fails at
  construction.
- One `HighApiError` for every failure, including timeouts and transport
  failures, carrying `status`, `code`, `requestId`, `messages` and `body`.
- Retries for `GET` and `HEAD` only, on 429 and 5xx, honouring `Retry-After` in
  both its forms, capped by `maxRetryDelayMs`. Writes are never retried.
- Configurable logging (`silent` to `debug`) with ISO-8601 timestamps, request
  and response bodies at `debug`, and credential redaction throughout.
- Cancellation through an `AbortSignal` on every method, honoured during a
  retry delay as well as during a request.
- Dual ESM and CJS builds with type declarations.
- `HighFeed`, a live datafeed client separate from `HighClient`, built from
  the same options and credentials. Production only — there is no sandbox
  feed, and a client configured for one refuses construction. Subscribes by
  HIGH scrip key through three dedicated method pairs —
  `subscribeQuotes`/`unsubscribeQuotes`, `subscribeDepth`/`unsubscribeDepth`,
  `subscribeIndices`/`unsubscribeIndices` — plus a matching `snapshotX` for
  each; an index key is rejected by the quote/depth methods and a non-index
  key by the index methods, in both directions. Merges the feed's delta ticks
  into complete typed snapshots (`Quote`, `Depth`, `IndexTick`) carrying a
  `changedFields` set, with prices kept as exact decimal strings and
  timestamps parsed as IST wall-clock. Splits a FULL market-watch tick's
  quote and top-of-book fields into two separate events, and never presents
  the resulting one-level book as a five-level one. Delivery is both an event
  emitter and an `AsyncIterable`. Reconnects on transport failure with
  backoff, re-authenticating and re-subscribing everything before reporting
  connected again; a rejected `cn` handshake (`HighFeedAuthError`, carrying
  `stCode`/`msg`/a named `reason`) is never retried or reconnected. Adds `ws`
  as the package's one runtime dependency, used only by `HighFeed`.

### Notes

- The redirect consent flow and token introspection are not wrapped. Auth is
  the TOTP endpoint only.
- Six scripKeys in the scrip master (e.g. `NSE@26002`) genuinely resolve to
  more than one index — one shared token, different index names — a data
  defect, not a join artefact. `HighFeed` rejects them explicitly, naming
  every candidate, rather than picking one. See `AMBIGUOUS_INDEX_KEYS` in
  `src/feed/index-map.generated.ts`.
