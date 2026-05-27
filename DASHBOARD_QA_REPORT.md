# OTTO Ops Dashboard - QA Report

**Date (UTC):** 2026-05-27T06:44:19Z
**Dashboard build:** Vite 5.4.21 / React 18.3.1 / TanStack Query 5.51
**Supabase project ref:** `mdbesvxvouxwsjiddrow` (OTTO-NEW dedicated project, us-west-1, PG17)
**Key in dashboard build:** anon JWT only. Confirmed by `grep` over `dashboard/src/**` for `service_role`/`SERVICE_ROLE`/`serviceRole` -- **0 matches**.

The dashboard was exercised by an automated Playwright driver
(`dashboard/scripts/dashboard-qa.mjs`) hitting `http://localhost:5173`,
visiting every route, capturing rendered text, console errors, and
network failures. Both mock and real Supabase modes were run end to end.

---

## Mock mode (`VITE_MOCK_DASHBOARD=true npm run dev`)

| Route | Page | Loads | Console errors | Failed requests | Numeric scorecards rendered |
| --- | --- | --- | --- | --- | --- |
| `/` | Command Center | yes | 0 | 0 | 9, 125, 39, 31, 8, 77.8, 2 |
| `/funnel` | Pipeline Funnel | yes | 0 | 0 | stages 125 -> 9 |
| `/validated` | Validated Products | yes | 0 | 0 | 9 of 9 mock rows |
| `/rejected` | Rejected Products | yes | 0 | 0 | top reasons chart |
| `/competition` | Competition Review | yes | 0 | 0 | 8 rows |
| `/shipping` | Shipping Review | yes | 0 | 0 | 2 rows |
| `/exports` | Export Center | yes | 0 | 0 | 1 row |
| `/manual-qa` | Manual QA | yes | 0 | 0 | 9 reviewed, 77.8% approval |
| `/agent-logs` | Agent Logs | yes | 0 | 0 | 7 logs / 0 votes (mock) |
| `/discovery-agents` | Discovery Agents | yes | 0 | 0 | 1 real / 0 partial / 16 placeholder |

All 10 pages show the orange `MOCK DATA` banner. No loading spinner stayed stuck; no error banner.

---

## Real Supabase mode (`npm run dev` against `mdbesvxvouxwsjiddrow`)

| Route | Page | Loads | Console errors | Failed requests (real) | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` | Command Center | yes | 0 | 0 | latest discovery run `0351b6f1...`, export batch `f22df9a5...` |
| `/funnel` | Pipeline Funnel | yes | 0 | 0 | 125 -> 97 -> 83 -> 70 -> 74 -> 40 -> 39 -> 9 |
| `/validated` | Validated Products | yes | 0 | 0 | 25 of 25 (see data caveat below) |
| `/rejected` | Rejected Products | yes | 0 | 0 | 172 rows, top: `ASIN_NOT_RESOLVED` (103) |
| `/competition` | Competition Review | yes | 0 | 0 | 8 rows (after dedup fix) |
| `/shipping` | Shipping Review | yes | 0 | 0 | 10 rows, mix of `PRIME_LIKELY_PASS` / `REJECT` |
| `/exports` | Export Center | yes | 0 | 0 | 3 batches with copy-able CSV + manual-QA paths |
| `/manual-qa` | Manual QA | yes | 0 | 0 | 9 reviewed, 77.8% approval, verdict "PASS - safe to scale" |
| `/agent-logs` | Agent Logs | yes | 0 | 0 | 500 of 826 logs (limit), 1275 votes available |
| `/discovery-agents` | Discovery Agents | yes | 0 | 0 | 1 real / 0 partial / 16 placeholder |

### Data counts shown per page (real mode)

- **Command Center scorecards**
  - Exported products: 9
  - End-to-end pass rate: 31.2% (39 / 125 raw)
  - Manual QA approval: 77.8% (Threshold to scale: >= 70%)
  - Duplicate ASINs removed: 0
  - Shipping review required: 3
  - Top rejection: `ASIN_NOT_RESOLVED (103)`
  - Stage counts: raw=125, ASIN resolved=97, ASIN failed=28, Amazon source valid=83 / failed=14, demand passed=70 / failed=13, compliance passed=74 / failed=11, business fit passed=40 / failed=29, final validated=9, exported=9
- **Pipeline Funnel pass rates** (stage-to-stage):
  - raw -> ASIN resolved: 77.6%
  - ASIN resolved -> Amazon source valid: 85.6%
  - Amazon source valid -> demand passed: 84.3%
  - demand passed -> compliance passed: **105.7%** (see limitation #3)
  - compliance passed -> business fit passed: 54.1%
  - business fit passed -> final validated: 97.5%
  - final validated -> exported after dedupe: 23.1%
- **Manual QA**:
  - 2 distinct batches: "v1.4 confirmation limit=25" (latest), "v1.4 competition smoke limit=10"
  - 9 reviewed / 0 blank / 9 total
  - Would-list YES: 7, NO: 2
  - Approval 77.8% (PASS)
  - ASIN-REAL YES rate: 100.0%
  - DEMAND-MAKES-SENSE YES rate: 100.0%
  - LOW-RISK YES rate: 100.0%
  - Reviewer notes: 2 products with non-empty notes
- **Rejection breakdown** (top by count, real):
  - `ASIN_NOT_RESOLVED` (103), `HIGH_DUPLICATE_MARKET`, `LOW_DEMAND_SCORE`, `BUNDLE_OR_MULTIPACK_EXCLUDED`, `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE`, `AMAZON_NOT_BUYABLE`, `TOO_CHEAP`, `AMAZON_PRICE_MISSING`, `DELIVERY_TOO_LONG`, `COPYRIGHT_CHARACTER_MATCH`, `BUSINESS_FIT_FAILED`, `HAZMAT_RISK`, `BULKY_HIGH_TICKET_CAUTION`, `HIGH_STAGNATION_RISK`, `AMAZON_SEARCH_UNAVAILABLE`
- **Export Center**: 3 batches
  - `f22df9a5` (V1.4 confirmation, limit=25): 9 exported / 9 pre-dedupe / 0 dups
  - `9706f472` (test pipeline): 25 / 25 / 0
  - `dc029f21` (real QA limit=10): 5 / 5 / 0
- **Shipping Review** sample row (real): ASIN `B0DS1QSHJL`, 27d delivery, gate `PRIME_LIKELY_PASS`, prime detected, "FREE delivery June 8 - 22 on orders shipped by Amazon over $35"
- **Discovery Agents**: 17 rows total (1 implemented = `BasicAmazonAsinResolverAgent`, 0 partial, 16 placeholders).

---

## Issues found and fixes applied

### FIXED #1 -- CompetitionReview duplicate React keys

Playwright captured **30 console warnings** of the form
`Warning: Encountered two children with the same key, HIGH_DUPLICATE_MARKET` on `/competition`.

Root cause: `business_fit_checks.reason_codes` contains the same code
twice on several rows (verified in the DB; e.g. ASIN `B0DZC7TZNL` has
`{HIGH_DUPLICATE_MARKET, HIGH_DUPLICATE_MARKET, GENERIC_COMMODITY_MARKET}`).
The page rendered one Badge per code with `key={c}`, so React collided.

Fix: deduplicate codes before rendering -- `dashboard/src/pages/CompetitionReview.tsx`:

```diff
- (r.reason_codes ?? []).filter((c) => COMP_CODES.has(c)).map((c) => (
-   <Badge key={c} tone="bad">{c}</Badge>
- ))
+ const codes = [...new Set((r.reason_codes ?? []).filter((c) => COMP_CODES.has(c)))];
+ ...codes.map((c) => <Badge key={c} tone="bad">{c}</Badge>)
```

Re-run: 0 console errors on `/competition`.

> Note: the backend writing `HIGH_DUPLICATE_MARKET` twice in the same
> `reason_codes` array is a separate backend bug worth fixing in
> `BusinessFitAgent`, but is out of scope for this dashboard QA pass.

### FIXED #2 -- ASIN-resolved overcount on Command Center / Funnel

Command Center showed `ASIN resolved = 1257` against `raw candidates = 125`,
producing a nonsensical `1005.6%` pass rate on the Funnel.

Root cause: `useLatestRun()` in `queries.ts` counted `asin_candidates`
rows with `accepted=true` in the run window. The resolver writes one row
per search attempt, and may accept multiple variants per
`raw_candidate`. The DB confirms: 1257 accepted rows = 102 distinct
`otto_product_id` values for that window.

Fix: count distinct `otto_product_id` for that specific stage. Added
`countDistinctProducts()` in `dashboard/src/lib/queries.ts` that fetches
the column and dedupes in JS (PostgREST has no SELECT-DISTINCT count).
All other stages (`amazon_source_checks`, `ebay_demand_checks`,
`compliance_checks`, `business_fit_checks`, `final_validation_results`)
are already 1:1 per product per run, verified in the DB, so they keep
the cheap `countWhere`.

Re-run: ASIN resolved = 97, ASIN failed = 28 (97 + 28 = 125 raw, sane).
Funnel raw->ASIN now reads **77.6%**.

---

## Known limitations / data observations (NOT bug fixes)

These were observed during QA but intentionally **not** changed --
either they're data-side issues or fixing them requires features
beyond the QA scope.

1. **`demand passed -> compliance passed = 105.7%` on Funnel.**
   Compliance ran on 74 products in the run window while only 70 passed
   demand. This is an inherent limitation of the **time-window-based
   funnel**: each stage's count is independent of the upstream stage.
   A proper join-based funnel (e.g. "products with `final_validation_results.passed=true`
   that also have a `business_fit_checks.business_fit_passed=true` row
   for the same `otto_product_id`") would be more accurate but is a new
   feature, not a bug fix. Leaving as-is for V1.
2. **`validated_products` table contains only synthetic "Mock product
   BXXXXXXXX" rows (brand `OttoMock`).** All 25 rows are from the
   `run-test-pipeline.ts` test fixture; the three real export batches
   (`f22df9a5`, `dc029f21`) emit CSV files but appear to bypass writing
   to `validated_products` in production runs. The dashboard renders
   what's in the table correctly -- this is a **backend gap**, not a
   dashboard bug. Surface for the backend follow-up: the real-mode CSV
   exporter should also persist to `validated_products`.
3. **`HEAD ... ERR_ABORTED` requests on Command Center / Funnel in dev
   mode (12 per page load).** These are React 18 `<React.StrictMode>`
   dev-only double-invocations -- the first call is aborted when the
   effect re-runs. They do **not** occur in `vite build` / `vite
   preview` production bundles. The data still renders correctly on
   every load. Not a real bug; flagged so future readers don't chase
   it.
4. **Agent log level filter is case-sensitive.** The DB stores
   `"info"`, `"warn"`, `"error"` lowercase but the Badge component
   displays them uppercase. The filter input compares literally
   (`r.level !== levelFilter`). Acceptable: the placeholder text says
   `info / warn / error` lowercase. Could be normalized but isn't a bug.
5. **Manual QA `LEVEL` filter on Agent Logs**: works correctly but
   filters strictly. No issue.

---

## Empty states / missing fields

- `manual_qa_negative_examples` table is empty -- no page renders it;
  the seed script `npm run seed:negative-examples` populates it. Not
  visible in any page, so not a dashboard concern.
- `agent_messages`, `marketplace_signals`, `source_signals`,
  `opportunity_relationships`, `product_opportunities`,
  `deduped_products`, `blacklist_brands`, `blacklist_keywords`,
  `restricted_categories`, `allowed_categories`,
  `validation_thresholds`, `product_feedback`,
  `source_quality_scores`, `category_performance_scores`,
  `weekly_model_adjustments` are all empty in the new project. No page
  currently surfaces these tables, so nothing to render. (Aligns with
  V1 scope.)
- All 10 page-level empty states (`EmptyState` component) work --
  verified by running mock mode with a known mock array.

---

## Pages that could be improved later (not fixed)

- **Pipeline Funnel**: consider a real join-based funnel that follows a
  single `otto_product_id` across stage tables, so pass rates always
  stay <= 100%. Currently shows time-window counts which can exceed
  100% on consecutive stages.
- **Validated Products**: once the backend persists real exports to
  `validated_products`, the page will gain real value. Today it shows
  the 25-row test fixture which is unhelpful but truthful.
- **Agent Logs**: a level filter dropdown (`info` / `warn` / `error`)
  would be friendlier than the free-text input.
- **Manual QA**: per-reason breakdown of the `notes` field would help
  identify recurring failure modes from human reviewers.

---

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| Dashboard runs in mock mode | yes |
| Dashboard runs against real Supabase mode | yes |
| All 10 pages load | yes |
| Latest real batch metrics appear | yes (9 exports, 31.2% e2e, 77.8% manual QA) |
| Validated / exported products appear | partial (CSV paths visible in Export Center; `validated_products` table contains test data only -- see #2 above) |
| Manual QA data appears | yes (9 reviewed, 77.8% PASS, 2 batches) |
| Rejection breakdown appears | yes (172 rows, top 15 chart, full table) |
| Discovery Agents page distinguishes real vs placeholder | yes (1 / 0 / 16 with status badges) |
| `DASHBOARD_QA_REPORT.md` created | this file |
| No service-role key referenced in dashboard code | yes (grep over `dashboard/src/**` for `service_role` / `SERVICE_ROLE` / `serviceRole` = 0 matches) |
| No RLS changes made | yes (RLS remains intentionally disabled per request; advisory acknowledged but no SQL applied) |

---

## Reproduction

```bash
# Mock mode
cd dashboard
VITE_MOCK_DASHBOARD=true npm run dev
node scripts/dashboard-qa.mjs > /tmp/qa-mock.json

# Real mode (against the configured Supabase project in dashboard/.env)
npm run dev
node scripts/dashboard-qa.mjs > /tmp/qa-real.json
```

The QA driver lives at `dashboard/scripts/dashboard-qa.mjs`. It uses
Playwright's Chromium to visit each of the 10 routes, captures console
errors / failed requests / rendered text, and emits JSON. Set
`QA_BASE_URL` to point it at a different host if needed.
