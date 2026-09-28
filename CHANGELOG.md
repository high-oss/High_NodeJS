# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] — 2026-09-28

First release. Pre-1.0: the surface may still change.

### Added

- `HighClient` covering 24 of the 27 HIGH Open API operations across five
  namespaces: `auth`, `orders`, `portfolio`, `scrips` and `market`.
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
- Dual ESM and CJS builds with type declarations, and no runtime dependencies.

### Notes

- The redirect consent flow and token introspection are not wrapped. Auth is
  the TOTP endpoint only.
- No datafeed socket client. `wsBaseUrl` is resolved but unused.
