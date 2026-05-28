# OTTO Amazon Access Runbook

Keepa discovery finds Amazon ASINs cheaply, **but those ASINs can only be
validated if the environment can actually load Amazon product pages.** If
Amazon PDPs don't load, every candidate fails source validation
(`AMAZON_PAGE_UNAVAILABLE` / `pageLoaded=false`) no matter how good the
Keepa input is — and you'd waste Keepa tokens finding ASINs you can't use.

Always confirm Amazon access **before** scaling Keepa discovery.

## Environment status meanings

`npm run test:amazon-environment` loads a few known-stable ASINs with the
**same Playwright client** `AmazonSourceValidationAgent` uses (no faking,
no validation-gate changes, **zero Keepa tokens**) and classifies:

| Status | Meaning | Safe to run Keepa? |
| --- | --- | --- |
| `AMAZON_ENV_READY` | ≥80% pages load and ≥60% capture title+price | Yes |
| `AMAZON_ENV_PARTIAL` | At least one loads but extraction inconsistent | Yes, but expect higher source-validation failure rates |
| `AMAZON_ENV_BLOCKED` | Captcha / block wall detected | No — use a proxy first |
| `AMAZON_ENV_UNUSABLE` | No pages load at all | No — network/egress blocked; use a proxy or another environment |

## How to run

### Locally

```bash
npm install
npx playwright install chromium   # one-time
npm run test:amazon-environment
```

### On Replit

Replit's default egress can usually reach Amazon. From the repo root:

```bash
npm install
npx playwright install chromium
npm run test:amazon-environment
```

If it reports `BLOCKED`/`UNUSABLE`, Replit's IP is likely rate-limited or
captcha-walled — configure a proxy (below) and re-test.

### With a proxy

```bash
export AMAZON_PROXY_SERVER="http://gate.example-proxy.com:7000"
export AMAZON_PROXY_USERNAME="your-username"
export AMAZON_PROXY_PASSWORD="your-password"   # never printed by OTTO
npm run test:amazon-environment -- --proxy
```

- `--proxy` **requires** `AMAZON_PROXY_SERVER` and fails clearly if it's
  missing.
- `--no-proxy` forces the proxy off even if the vars are set (useful to
  compare direct vs proxied access).
- A residential or datacenter proxy with US exit IPs is usually what
  turns `BLOCKED`/`UNUSABLE` into `READY`/`PARTIAL`.

OTTO never requires, purchases, or auto-configures a proxy.

### Single ASIN + debug diagnostics

```bash
npm run test:amazon-environment -- --asin=B0DZC7TZNL --debug
npm run test:amazon-environment -- --headful           # visible browser (if supported)
npm run test:amazon-environment -- --zip=84107         # delivery ZIP (best-effort)
```

`--debug` saves, under `reports/amazon-env-diagnostics/<timestamp>/`:
screenshot (`.png`), HTML snapshot (`.html`), and `.meta.json` (final URL,
user agent, viewport, proxy enabled true/false, error classification,
network-error summary), plus a `summary.json`. **It never saves cookies,
credentials, or the proxy password**, and URLs are stripped of query
strings.

## Verifying the proxy is actually used (without printing secrets)

- `test:amazon-environment` prints `proxy mode: enabled (host:port)` or
  `disabled`. Only the **host:port** is shown — username/password are
  never printed.
- In `--debug`, `meta.json` includes `proxyEnabled: true/false` (boolean
  only).
- If you set proxy vars but still see `proxy mode: disabled`, you likely
  passed `--no-proxy`, or the vars aren't exported in this shell.

## Fixing specific failures

### `NAVIGATION_FAILED`

The page never loaded (DNS/connection/egress blocked, or the IP can't
reach Amazon).

1. Confirm general egress works (`curl -I https://www.amazon.com` from the
   same environment).
2. If egress is blocked, you're in a restricted sandbox — run where Amazon
   is reachable, or configure a proxy.
3. Re-test: `npm run test:amazon-environment -- --proxy`.

### `CAPTCHA_OR_BLOCK`

Amazon served a captcha / robot wall.

1. The IP is flagged. Use a residential/datacenter proxy
   (`AMAZON_PROXY_SERVER`).
2. Reduce request rate; avoid running many Amazon jobs back-to-back.
3. Re-test with `--proxy`. Capture evidence with `--debug` (screenshot of
   the captcha page).

### `TIMEOUT`

The page started but didn't finish within `AMAZON_SEARCH_TIMEOUT_MS`.

1. Often a slow proxy or a throttled IP. Try a faster proxy, or raise
   `AMAZON_SEARCH_TIMEOUT_MS` modestly.
2. Re-test and check whether it becomes `READY`/`PARTIAL`.

## When it is safe to run Keepa discovery

- **READY** → safe to run and scale.
- **PARTIAL** → safe to run; expect more source-validation failures, so
  start with a small `--limit`.
- **BLOCKED / UNUSABLE** → **stop.** Do not spend Keepa tokens. Fix access
  (proxy / different environment) and re-test until READY/PARTIAL.

### Preflight gating (built in)

Both Keepa runners accept `--preflight-amazon`: they run this check first
and **stop before consuming any Keepa tokens** if the environment is
`BLOCKED`/`UNUSABLE` (unless `--force`):

```bash
npm run run:keepa-discovery -- --profile=balanced --limit=25 --preflight-amazon
npm run calibrate:keepa-discovery -- --limit=25 --preflight-amazon
```

### One-command production preflight

```bash
npm run preflight:production
```

Runs `check:env` + `test:amazon-environment` (and optionally a dashboard
typecheck with `--with-dashboard-typecheck`) and prints a clear verdict:
**OK to run Keepa discovery** or **NOT OK to run Keepa discovery**. It
consumes no Keepa tokens.

## Dashboard

The latest environment check is shown on the **Discovery Agents** page
(status, loaded/blocked/timeout/nav-failed counts, proxy enabled +
masked host). Checks are stored in the `amazon_environment_checks` table
(no secrets).
