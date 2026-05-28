# OTTO Deployment Preflight Checklist

Run top-to-bottom in any new runtime (local, Replit, GCE VM, Cloud Run,
Render, …) before running real OTTO jobs. **No Keepa tokens are consumed
by any step except the optional small batches at the end.**

Fastest path: `npm run doctor:runtime` runs most of this and prints
`RUNTIME_READY_FOR_*` booleans. This checklist is the manual/expanded
version.

## 0. Required environment variables

Backend (`.env` in repo root — never commit it):

| Var | Needed for | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | everything | OTTO project ref `mdbesvxvouxwsjiddrow` |
| `SUPABASE_SERVICE_ROLE_KEY` | backend writes | server-side only |
| `SUPABASE_ANON_KEY` | dashboard | read-only |
| `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` | discovery + demand | or `EBAY_OAUTH_TOKEN` |
| `KEEPA_API_KEY` | Keepa discovery | only for Keepa runs |
| `OTTO_MOCK_MODE=false` | real jobs | must be false |
| `OTTO_REAL_EBAY_DISCOVERY=true` | real eBay QA | |
| `AMAZON_HEADLESS=true` | servers/CI | |
| `AMAZON_IGNORE_HTTPS_ERRORS=false` | production | dev-only escape hatch; keep false |
| `AMAZON_PROXY_SERVER` / `_USERNAME` / `_PASSWORD` | only if Amazon is BLOCKED/UNUSABLE | residential proxy |

Dashboard (`dashboard/.env`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_MOCK_DASHBOARD=false`.

Verify presence (no secrets printed):

```bash
npm run check:env
```

## 1. Install & build

```bash
npm install
npx playwright install chromium        # one-time; installs the browser
# (on bare Linux you may also need: npx playwright install-deps chromium)
npm run typecheck                      # backend compiles
( cd dashboard && npm install && npm run typecheck )
```

## 2. Playwright / browser requirements

- Chromium installed (`npx playwright install chromium`).
- On servers: system libs present (`npx playwright install-deps chromium`
  on Debian/Ubuntu), ≥1 vCPU and ≥1–2 GB RAM for headless Chromium.
- Headless is fine; no display needed (`AMAZON_HEADLESS=true`).

## 3. Supabase connectivity

```bash
npm run doctor:runtime -- --skip-amazon    # prints Supabase connection OK/FAIL
```

(Confirms the service-role key can reach the OTTO project.)

## 4. eBay API check

`doctor:runtime` performs a live 1-item Browse call (verifies OAuth token
+ egress). Expect `eBay API (live token+search): OK`.

## 5. Keepa API check

Key **presence** only (we do not spend Keepa tokens in preflight).
`doctor:runtime` prints `KEEPA_API_KEY: OK (presence only)`. A real Keepa
call happens later only when you run a small Keepa batch.

## 6. Amazon environment check (the gate)

```bash
npm run test:amazon-environment
# with a proxy:
npm run test:amazon-environment -- --proxy
# single ASIN + diagnostics on failure:
npm run test:amazon-environment -- --asin=B0DZC7TZNL --debug
```

Proceed only if the result is `AMAZON_ENV_READY` (best) or
`AMAZON_ENV_PARTIAL` (ok, expect more source-validation failures).
`BLOCKED` / `UNUSABLE` → fix per `AMAZON_ACCESS_RUNBOOK.md` first.

## 7. One-command gate

```bash
npm run doctor:runtime          # RUNTIME_READY_FOR_EBAY_QA / _KEEPA_DISCOVERY / _DASHBOARD
npm run preflight:production    # OK / NOT OK to run Keepa discovery (env + amazon)
```

Both must say ready / OK before spending Keepa tokens.

## 8. Dashboard check

```bash
cd dashboard
npm run dev            # http://localhost:5173 (or VITE_MOCK_DASHBOARD=true for offline)
npm run build          # production bundle
```

The Discovery Agents page shows the latest Amazon environment status.

## 9. Small real batches (consume minimal API)

eBay QA (uses eBay + Amazon; no Keepa):

```bash
npm run run:real-qa -- --limit=10
```

Keepa discovery (ASIN-native; preflight stops it if Amazon is unusable):

```bash
npm run run:keepa-discovery -- --profile=balanced --limit=10 --preflight-amazon
```

Inspect the run report under `reports/`, the CSV under `exports/`, and the
dashboard (Command Center / Validated Products / Export Center).

## 10. Rollback / stop

- **Stop a run**: `Ctrl-C`. Runs are incremental; partial work already
  written to Supabase is harmless (no external side effects — OTTO does
  not upload/list anything).
- **Stop spending Keepa tokens**: don't run `run:keepa-discovery` /
  `calibrate:keepa-discovery`; or rely on `--preflight-amazon` which stops
  before token spend when Amazon is BLOCKED/UNUSABLE.
- **Disable real calls fast**: set `OTTO_MOCK_MODE=true` (everything runs
  on synthetic data; writes are marked synthetic and excluded from the
  dashboard's real views).
- **Revert a bad config**: restore `.env`; no migrations are required to
  stop jobs. Validation gates and RLS are unchanged by deployment.
- **Undo a test export batch**: delete the `export_batches` row (and its
  `validated_products` / `export_exclusions` rows) for that
  `export_batch_id`; nothing external references it.
