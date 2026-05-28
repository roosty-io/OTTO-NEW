# OTTO Research Engine - V1 (internal)

Internal product research and validation backend for Amazon-to-eBay
dropshipping candidates.

V1 scope:

```
Discovery -> ASIN Resolution -> Amazon Source Validation -> eBay Demand
Scoring -> Compliance Risk Scoring -> Cost Calculation -> Final
Validation -> CSV Export
```

V1 is **not** a SaaS product. There are no user accounts, subscriptions,
AutoDS uploads, listing optimization, image processing, or public
dashboards. The deliverable is a CSV of validated product candidates and
the underlying Supabase tables.

## Quick start

```bash
cp .env.example .env             # fill in credentials, or leave blank to use mock mode
npm install
psql "$DATABASE_URL" -f src/db/schema.sql   # or paste into Supabase SQL editor
npm run seed:rules               # seed allowed/restricted categories, brand & keyword blacklists, thresholds
```

Two test modes are available:

### Mock mode (offline, deterministic)

```bash
OTTO_MOCK_MODE=true npm run test:pipeline
```

- All upstream calls return synthetic data (eBay, Amazon, Keepa, Zik).
- Exercises the full Discovery -> ASIN -> Amazon -> Demand -> Compliance ->
  Cost -> Final -> CSV flow end to end without credentials.
- Use this for refactors, schema changes, and local smoke tests.

### Real eBay discovery mode

```bash
# default seed keywords, 50 results per keyword
npm run test:real-ebay

# custom keywords + smaller limit
npm run test:real-ebay -- "stainless lazy susan" "bamboo drawer divider" --limit=20
```

- Sets `OTTO_REAL_EBAY_DISCOVERY=true` and `OTTO_MOCK_MODE=false` for the run.
- Hits the live eBay Browse API for discovery and demand scoring.
- The **ASIN resolver is live** (Playwright Chromium) - real eBay candidates
  are turned into real Amazon.com ASINs by `BasicAmazonAsinResolverAgent`.
- The Amazon **product-detail scraper** (stock / delivery / variations) is
  still pending, so candidates with confirmed ASINs are currently rejected
  at `AmazonSourceValidationAgent` with `AMAZON_VALIDATION_UNAVAILABLE`.
  Nothing fake reaches the validated CSV.
- Exits with code `2` if `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (or
  `EBAY_OAUTH_TOKEN`) are missing.

### Keepa rank-movement discovery (ASIN-native)

`KeepaRankMovementDiscoveryAgent` discovers Amazon products with
**improving sales rank** directly from Keepa, so candidates arrive with a
confirmed ASIN and **bypass the eBay→ASIN resolver** (the dominant funnel
loss). They then run through the exact same validation chain as real QA
(Amazon source → demand → compliance → business fit → cost → final →
same-batch dedupe → cross-batch filter → CSV + manual QA + persistence).

```bash
# Calibration profiles (strict / balanced / broad / exploratory)
npm run run:keepa-discovery -- --profile=balanced --limit=25
npm run run:keepa-discovery -- --profile=broad --limit=25
# Explicit overrides (win over the profile)
npm run run:keepa-discovery -- --min-rank-improvement=8 --min-price=12 --max-price=120
npm run run:keepa-discovery -- --category="Home & Kitchen" --allow-repeats
npm run run:keepa-discovery -- --repeat-policy=never_repeat
```

Profiles (tune **discovery input only** — validation gates are unchanged):

| Profile | min rank improvement | price band | use |
| --- | --- | --- | --- |
| `strict` | 20% | $12–$150 | tightest |
| `balanced` | 10% | $10–$150 | recommended default |
| `broad` | 5% | $10–$200 | leans on downstream gates |
| `exploratory` | 0% | $5–$300 | diagnostics only, not for default exports |

- Targets safer V1 categories only (Home & Kitchen, Tools & Home
  Improvement, Patio/Lawn/Garden, Office Products, Arts/Crafts/Sewing,
  Pet Supplies — excluding ingestibles/medical/supplements, plus a
  defense-in-depth title/category exclusion filter). Tunable via
  `KEEPA_DISCOVERY_*` env vars.
- **Sales-rank ceiling** `KEEPA_DISCOVERY_MAX_SALES_RANK` (default 150000)
  stops the Keepa Product Finder from returning dead, multi-million-rank
  products — the key calibration lever (without it, discovery returned
  11M-rank junk).
- **No fake data in real mode.** If the Keepa account/plan lacks the
  Product Finder endpoint, the run reports `KEEPA_PLAN_LIMITATION` /
  `KEEPA_ENDPOINT_UNAVAILABLE` and produces zero candidates rather than
  inventing any.
- Filter losses are reported with reason codes
  (`KEEPA_RANK_IMPROVEMENT_TOO_LOW`, `KEEPA_CATEGORY_EXCLUDED`,
  `KEEPA_PRICE_TOO_LOW`/`_HIGH`, `KEEPA_MISSING_ASIN`/`_TITLE`/`_PRICE`,
  `KEEPA_UNSUPPORTED_CATEGORY`).
- Persists exported products to `validated_products` with
  `primary_discovery_source = keepa_rank_movement`.
- Unit tests: `npm run test:keepa-discovery`.

#### Keepa calibration

```bash
npm run calibrate:keepa-discovery -- --limit=25     # runs strict -> balanced -> broad
npm run calibrate:keepa-discovery -- --limit=10     # cheaper token cost first
```

Runs each profile through the full validation chain and writes a
side-by-side comparison to `reports/otto-keepa-calibration-<timestamp>.md`
with per-profile Keepa token usage, raw products, filter-loss reason
codes, funnel counts, and Amazon source-validation failure diagnostics
(reason, page-loaded, price, buyable, stock, delivery gate, restricted
signals). It prints a rough Keepa token estimate before running.

### ASIN resolver smoke test

```bash
# Default: 10 canonical V1 product titles
npm run test:asin-resolver

# Custom titles
npm run test:asin-resolver -- "ceramic plant pot" "rolling cart organizer"
```

- Launches headless Chromium and runs `BasicAmazonAsinResolverAgent` against
  each title.
- Prints the input, the generated queries, and either the best matching
  ASIN / URL / title / match type / confidence or a rejection reason.
- All attempts are persisted to `asin_candidates` with their score breakdown
  and `accepted=true|false`.
- One-time setup: `npx playwright install chromium`.

### Export deduplication

Every CSV export is deduped at the ASIN level by `CsvExportAgent.run()`
before either CSV is written, so the same Amazon product can never
appear twice in the canonical export or in the manual QA review sheet.

Priority for which row is kept when an ASIN appears multiple times:

1. highest `final_validation_score`
2. highest `sell_within_30_days_confidence`
3. lowest `policy_risk_score`
4. lowest `stagnation_risk_score`
5. most recent `validated_at`

Removed rows are logged to `deduped_products` (with the kept ASIN, both
`otto_product_id`s, and the kept-vs-removed score diff) and emit an
`EXPORT_DEDUPED_ASIN` event into `agent_logs`.  `export_batches`
records `final_validated_before_dedupe`, `duplicate_asins_removed`,
and `final_exported_after_dedupe` for at-a-glance review.

### Cross-batch repeat filtering

After same-batch dedupe, `CsvExportAgent` also filters ASINs that were
already exported in **earlier** batches, so the same product isn't
re-listed across runs.  Only **non-synthetic** `validated_products` rows
count as prior exports, so test-pipeline / mock rows never block real
exports.

Policy is set by `EXPORT_REPEAT_POLICY` (env) or per-run CLI flags:

| Policy | Behavior |
| --- | --- |
| `allow_repeats` | only same-batch dedupe applies (old behavior) |
| `exclude_recent` | drop ASINs exported within `EXPORT_REPEAT_LOOKBACK_DAYS` (default 30) — **the default** |
| `never_repeat` | drop ASINs that ever appear in non-synthetic `validated_products` |

```bash
# default (exclude_recent, 30-day lookback)
npm run run:real-qa -- --limit=25

# restore old behavior for apples-to-apples QA
npm run run:real-qa -- --limit=25 --allow-repeats

# custom policy / window
npm run run:real-qa -- --limit=25 --repeat-policy=exclude_recent --repeat-lookback-days=7
npm run run:real-qa -- --limit=25 --repeat-policy=never_repeat
```

Excluded ASINs are written to `export_exclusions` (with the prior batch
id + prior export date and the reason — `PREVIOUSLY_EXPORTED_ASIN` or
`PREVIOUSLY_EXPORTED_RECENTLY`), recorded in `rejected_products` under
`CROSS_BATCH_DEDUPED_ASIN`, and emit an `agent_logs` event.
`export_batches` records `same_batch_duplicates_removed`,
`cross_batch_repeats_removed`, `exported_after_all_filters`,
`repeat_policy`, and `repeat_lookback_days`.  Unit cases:
`npm run test:cross-batch-filter`.

### Manual QA review workflow

After `npm run run:real-qa` finishes, open
`exports/otto_manual_qa_review_<YYYY-MM-DD>.csv` and fill in the five
reviewer columns for each row:

```
would_list_yes_no, asin_real_yes_no, demand_makes_sense_yes_no,
low_risk_yes_no, notes
```

Then import:

```bash
npm run import:manual-qa -- \
  --file=exports/otto_manual_qa_review_2026-05-25.csv \
  --batch-label="second real QA batch"
```

The script:

- inserts every row into `manual_qa_reviews` (blank reviewer cells stay
  blank — no answers are ever invented)
- prints would-list yes / no / blank counts, the **would-list approval
  rate** over reviewed rows only, plus ASIN-real / demand-makes-sense /
  low-risk yes rates and a list of failed-QA products
- writes `reports/otto-manual-qa-summary-<timestamp>.md` with the same
  numbers and a clear verdict line

#### Interpreting the approval rate

- **>= 70% would-list yes** over the reviewed rows: **PASS** — safe to
  scale the next batch (e.g. raise `--limit`).
- **< 70% would-list yes**: **HOLD** — do not scale.  Tune the failing
  axis (most often `policyRiskScore` weights or demand thresholds) and
  re-run a fresh `run:real-qa`.
- **0 reviewed rows** (the script reports `NOT REVIEWED`): the CSV
  hasn't been filled in yet.

#### When to scale to the next limit

After two consecutive batches at the current `--limit` cleared >= 70%
approval, raise to the next step (e.g. 10 → 25 → 50 → 100).  Don't
raise `--limit` and broaden `--keywords` in the same step.

### Current milestone

The **first real QA batch** (50 raw candidates → 13 exported) achieved
**~76.9% would-list approval** (10 of 13) based on the operator's
batch-level review.  Per-product reviewer answers have not yet been
filled into the CSV, so they have not been imported into
`manual_qa_reviews`; the batch-level result is documented in
`reports/otto-manual-qa-summary-first-batch.md`.  Once the per-product
CSV is filled, the same `import:manual-qa` workflow above will record
the detailed answers.

### How to run the first real QA batch

Before scaling, run a small real end-to-end batch and review the manual
QA CSV.  The QA script wraps the full real chain (eBay discovery -> ASIN
resolution -> Amazon source validation -> eBay demand scoring ->
compliance council -> cost -> final validation -> CSV export) with safe
defaults.

```bash
# Required env (in .env or shell):
#   EBAY_CLIENT_ID + EBAY_CLIENT_SECRET  (or EBAY_OAUTH_TOKEN)
# One-time setup:
npx playwright install chromium

# Default: 5 seed keywords x 25 candidates each
npm run run:real-qa

# Smaller smoke batch
npm run run:real-qa -- --limit=10

# Custom keywords
npm run run:real-qa -- --keywords="bamboo drawer divider,rolling utility cart"

# Custom keywords + smaller limit
npm run run:real-qa -- --limit=10 --keywords="under sink organizer,garage storage rack"
```

The script prints a full summary including:
- `discovery_run_id`, `export_batch_id`
- stage-by-stage counts (raw / ASIN resolved + failed / Amazon source
  valid + failed / demand passed + failed / compliance passed + failed /
  cost calculated / final validated + rejected / exported)
- end-to-end pass rate
- rejection-code breakdown (e.g. `ASIN_NOT_RESOLVED: 42`,
  `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE: 21`, `COMPLIANCE_HARD_BLOCK: 3`)
- top 10 passing products with ASIN / URL / title / brand / price /
  delivery days / 30d confidence / stagnation / policy risk / final
  score
- both the main export CSV path and the manual QA review CSV path

**Two CSVs are written under `./exports/`:**

1. `otto-validated-<timestamp>.csv` - the canonical 45-column export.
2. `otto_manual_qa_review_<YYYY-MM-DD>.csv` - a slim sheet for human
   review with these columns:

   ```
   otto_product_id, asin, amazon_url, product_title, brand,
   amazon_price, delivery_days, sell_within_30_days_confidence,
   stagnation_risk_score, policy_risk_score, final_validation_score,
   would_list_yes_no, asin_real_yes_no, demand_makes_sense_yes_no,
   low_risk_yes_no, notes
   ```

   The last five columns are blank for a human reviewer.

**How to interpret the pass rates**

- **Raw -> final validated < 5%**: very strict.  Expected for V1 since
  every gate (real ASIN match >= 75 conf, in-stock + <= 10d delivery, no
  Amazon Basics / multipack / restricted, demand 30d-conf >= 70 + low
  stagnation + relevant comparables >= 5, policy risk <= 35) must
  succeed simultaneously.
- **Raw -> final validated > 20%**: suspiciously loose.  Inspect the
  rejection breakdown - a missing gate code suggests a regression.
- **`ASIN_NOT_RESOLVED` + `LOW_CONFIDENCE_ASIN_MATCH` dominate**: most
  eBay candidates didn't have a clean Amazon counterpart.  Expand
  keywords or revisit query strategies in `ebayQueryBuilder`.
- **`DELIVERY_TOO_LONG` / `AMAZON_PRICE_MISSING` spike**: marketplace or
  scraping issue on a specific seller / category.
- **`COMPLIANCE_HARD_BLOCK` spike**: keyword surface is brand-heavy.
  Pick safer seeds (organizer / storage / utility) for the first QA.

**How to manually review the QA CSV**

1. Open `otto_manual_qa_review_<date>.csv` in Sheets / Excel.
2. For each row, open the `amazon_url` and check:
   - is the ASIN real and the page the actual product?
   - does the title match what we discovered on eBay?
   - is the price still what we captured?
   - does the demand "feel right" - would this product realistically
     sell on eBay within 30 days?
   - any policy / brand / IP risk you'd refuse to list?
3. Fill the five reviewer columns with `yes` / `no`.  Add notes for
   borderline calls.

**Target approval rate before scaling**

Target a `would_list_yes_no = yes` rate of **>= 70%** on the manual QA
CSV before raising `--limit` or removing keyword filters.  If approval
is below 70%, tune the failing axis (most often `policyRiskScore` or
`demandScore` weights, occasionally an ASIN resolver false-positive) and
re-run a fresh batch.  Do not scale until the manual approval rate
sustains above 70% for two consecutive batches.

### Compliance smoke test

```bash
npm run test:compliance
```

Runs the hardened `ComplianceRiskCouncil` against a fixed set of 5 safe
organizers and 10 risky products (Disney bin, iPhone MagSafe charger,
Nike shoe organizer, LEGO case, medical-grade knee brace, tactical
self-defense flashlight, baby car seat cover, Gucci-inspired handbag,
Pokemon party supplies, pesticide sprayer).  Prints policy risk score,
matched brands / keywords, triggered agents, and reason codes for each.

Hard-block sub-agents (`fail` + bucket=vero/restricted/ip) drive
`hard_block=true`.  Policy risk 36-50 results in `manual_review`,
51+ rejects.  Safe organizer titles like "2 tier under sink organizer"
do not falsely match weapon / multipack signals.

### eBay demand smoke test

```bash
# Default 5 known-good Amazon products
npm run test:ebay-demand

# Pull latest source-valid Amazon products from the database
npm run test:ebay-demand -- --from-db

# Single ad-hoc product
npm run test:ebay-demand -- --asin B0C6MC5N19 --title "Spice Rack Organizer for Cabinet" --price 29.99 --keyword "spice rack organizer"
```

- Generates 4-6 eBay queries from the Amazon title / brand / category /
  keyword (core keyword, normalized title, brand-removed title, simplified
  noun phrase, category+keyword, same-use-case phrase).
- Fetches comparable active listings from the live Browse API and scores
  each one for title similarity / keyword overlap / category match /
  price-band similarity / brand conflict / product-type match / listing
  quality / combined comparable confidence.
- Classifies each comparable as `EXACT_MATCH`, `SIMILAR_MATCH`,
  `SAME_PRODUCT_DIFFERENT_BRAND`, `ADJACENT_ALTERNATIVE`,
  `COMPLEMENTARY_PRODUCT`, `CATEGORY_GAP`, `TREND_GAP`, or
  `LOW_CONFIDENCE`.
- Aggregates: `active_listing_count`, `relevant_comparable_count`,
  `exact_or_similar_match_count`, unique sellers, seller concentration,
  median / average / band prices, listing quality gap, competition
  density, price viability, duplicate ratio.
- Computes `demand_score`, `sell_within_30_days_confidence`,
  `stagnation_risk_score`, `category_velocity_score`,
  `keyword_demand_score`, `competitor_success_score`, `saturation_score`,
  `trend_momentum_score`, `demand_type`.
- Hard gates: `sell_within_30_days_confidence >= 70`,
  `stagnation_risk_score <= 40`, `demand_score >= 65`,
  `relevant_comparable_count >= 5`. Failures persist with one of
  `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE`, `HIGH_STAGNATION_RISK`,
  `LOW_DEMAND_SCORE`, `NOT_ENOUGH_RELEVANT_COMPARABLES`,
  `EBAY_DEMAND_API_ERROR`, `EBAY_DEMAND_UNAVAILABLE`,
  `IRRELEVANT_EBAY_COMPARABLES`.
- The engine does **not** pass a product just because eBay returned
  listings: only listings scoring >= 60 comparable confidence count as
  "relevant", and the gates require margin viability against the Amazon
  source price.

### Shipping gate (Prime / FBA / Amazon-fulfillment)

OTTO runs in a public guest Playwright context (no Amazon login, no
stored Amazon credentials).  The legacy gate hard-rejected products
whose guest delivery was slow or unparseable, but those same products
often ship same-day or next-day for Prime members - we don't want
false rejects.

The V1 shipping gate combines parsed delivery with **visible**
Prime / FBA / Amazon-fulfillment signals (Prime badge, "FREE Prime
delivery" / "FREE delivery Tomorrow" / "Or fastest delivery ...",
`Ships from Amazon`, `Sold by Amazon`, `Fulfilled by Amazon`) and
classifies each product as one of:

| Outcome | When |
| --- | --- |
| `pass` | parsed delivery <= 10 days; **always** advances |
| `prime_likely_pass` | parsed delivery > 10 days OR unparseable, AND a Prime/FBA signal is visible.  Advances but `shipping_review_required = true`. |
| `reject` | parsed delivery > 10 days with no Prime/FBA signal (`DELIVERY_TOO_LONG`), OR unparseable with no Prime/FBA signal (`DELIVERY_UNCLEAR`) |

`prime_likely_pass` rows surface to the CSV / manual QA sheet with
`shipping_review_required=true` so a human can verify shipping in
their own logged-in Prime account.  Run `npm run test:shipping-gate`
to exercise the cases.

### Amazon source-validation smoke test

```bash
# Default ASINs (from earlier resolver runs)
npm run test:amazon-source

# Specific ASINs
npm run test:amazon-source -- B0C6MC5N19 B0DD47PMQQ

# Pull accepted ASINs from the database
npm run test:amazon-source -- --from-db
```

- Opens each canonical `/dp/<ASIN>` page in headless Chromium.
- Extracts title, brand, price + currency, availability, buy-now / add-to-cart
  presence, delivery text (parsed into days + window), seller / ships-from /
  sold-by, condition, rating, review count, coupons, bullets, breadcrumbs,
  and warning badges.
- Runs the full hard-exclusion ladder (out-of-stock, no price, delivery > 10d,
  Amazon Basics, used / renewed / refurbished, bundle / multipack,
  restricted signals) plus the `scoreAmazonSource` heuristic.
- Persists every result to `amazon_source_checks` with `source_valid` /
  `source_validity_score` / `rejection_reason`.
- The `2 tier` / `3 tier` guardrail is enforced - organizer products that
  describe themselves as "2 tier" / "3-layer" are never treated as
  multipacks.

The pipeline writes a CSV into `./exports/otto-validated-<timestamp>.csv`
and prints a stage-by-stage summary.

### Required env vars

| Mode                | Required                                                              |
|---------------------|-----------------------------------------------------------------------|
| Mock                | (none) - set `OTTO_MOCK_MODE=true`                                    |
| Real eBay discovery | `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`, or `EBAY_OAUTH_TOKEN`        |
| Real ASIN resolver  | `npx playwright install chromium` (Chromium binary on the machine)    |
| Persistence         | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (otherwise the in-memory stub) |

Amazon resolver tunables (all optional, defaults shown):

```
AMAZON_HEADLESS=true
AMAZON_SEARCH_TIMEOUT_MS=30000
AMAZON_MAX_RESULTS_PER_QUERY=10
AMAZON_MAX_QUERIES_PER_CANDIDATE=4
AMAZON_PROXY_SERVER=
AMAZON_PROXY_USERNAME=
AMAZON_PROXY_PASSWORD=
AMAZON_DEBUG=false                  # non-headless + slowMo when true
AMAZON_IGNORE_HTTPS_ERRORS=false    # dev/test only - never enable in production
```

### Real-mode limitations (V1)

- **Amazon ASIN resolution** is live (Playwright Chromium): real ASIN
  candidates per eBay candidate, scored on title similarity, keyword
  overlap, brand risk, and private-label heuristics. Multi-pack, bundle,
  renewed, refurbished, and Amazon Basics matches are hard-excluded;
  low-confidence matches are rejected with `LOW_CONFIDENCE_ASIN_MATCH`.
- **Amazon source-page validation** is live (Playwright Chromium): real
  product pages are opened, prices / stock / delivery / condition /
  coupons / breadcrumbs / warning badges are extracted, and products are
  rejected with explicit codes (`AMAZON_OUT_OF_STOCK`,
  `AMAZON_PRICE_MISSING`, `DELIVERY_TOO_LONG`, `BUNDLE_OR_MULTIPACK_EXCLUDED`,
  `USED_RENEWED_REFURBISHED`, `AMAZON_BASICS_EXCLUDED`, `HAZMAT_SIGNAL`,
  `MEDICAL_DEVICE_SIGNAL`, `WEAPON_SIGNAL`, `FOOD_SUPPLEMENT_SIGNAL`,
  `RESTRICTED_PRODUCT_SIGNAL`, `AMAZON_BLOCKED_OR_CAPTCHA`,
  `AMAZON_PAGE_UNAVAILABLE`).
- **Keepa** and **Zik** clients are still placeholders - their data is
  not yet folded into demand or compliance scoring.
- **Demand scoring** runs against real eBay Browse data but until the Zik
  signals are wired in, the heuristics are based on competitor listings
  alone.

### Interpreting the summary

The real-eBay script prints:

```
raw candidates       eBay items normalized into raw_candidates
ASIN resolved        candidates that got a confirmed ASIN (0 until real Amazon client lands)
Amazon valid         candidates that passed in-stock / delivery / bundle checks
demand valid         candidates with sell_within_30_days_confidence>=70 and stagnation<=40
compliance valid     candidates with policy_risk_score<=35 and no hard reject
cost calculated      candidates whose totalCostEstimate was computed
final validated      candidates that passed every V1 gate (exported to CSV)
rejected             total rejection events (also broken out per reason code)
CSV path             location of the latest export file
```

Stage-by-stage drop-offs and the `rejection reasons` breakdown make it
obvious which validation gate is filtering the most candidates.

## Ops dashboard

A read-only Vite + React dashboard lives under `dashboard/`. It queries
the OTTO Supabase project with the **anon key only** (the service-role
key never leaves the backend). Use it locally or on Replit to inspect
every signal the pipeline writes.

```bash
cd dashboard
cp .env.example .env             # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm install
npm run dev                      # http://localhost:5173
```

Offline preview (no Supabase):

```bash
VITE_MOCK_DASHBOARD=true npm run dev
```

Pages: Command Center, Pipeline Funnel, Validated Products, Rejected
Products, Competition Review, Shipping Review, Export Center, Manual QA,
Agent Logs, Discovery Agents. See `dashboard/README.md` for the full
per-page breakdown.

## Project layout

```
src/
  agents/
    discovery/         EbayKeywordDiscoveryAgent + futureAgents.ts placeholder
    asin/              BasicAmazonAsinResolverAgent
    amazon/            AmazonSourceValidationAgent
    ebay/              EbayDemandScoringAgent
    compliance/        ComplianceRiskCouncil + 15 single-purpose sub-agents
    cost/              CostCalculationAgent
    validation/        FinalValidationAgent
    export/            CsvExportAgent
    feedback/          (V2+) feedback-loop agents
  clients/             ebay / amazon-browser / keepa / zik-browser / supabase
  config/              env.ts / thresholds.ts / categories.ts
  db/                  schema.sql + seed.ts + migrations/
  scripts/             run-test-pipeline.ts, export-latest-csv.ts, seed-rules.ts, apply-schema.ts
  types/               product.ts / agent.ts / validation.ts
  utils/               logger / scoring / csv / normalize
```

Each agent has one job. They communicate by writing to dedicated
Supabase tables (`amazon_source_checks`, `ebay_demand_checks`,
`compliance_checks`, `cost_calculations`, `final_validation_results`)
and by emitting structured `agent_logs`, `agent_votes`, and
`agent_messages`. Every failed product gets a row in
`rejected_products` with a reason.

## Validation gates

A product is exported only when **all** of these hold:

- confirmed Amazon.com ASIN
- valid Amazon product URL
- in stock
- delivery to ZIP `84107` within 10 days (when delivery is known)
- not a bundle / multipack
- not renewed / refurbished
- not Amazon Basics
- not in a restricted category and no policy hard block
- `policy_risk_score <= 35`
- `sell_within_30_days_confidence >= 70`
- `stagnation_risk_score <= 40`
- `final_validation_score >= 75`

Thresholds live in `src/config/thresholds.ts` and are also seeded into
the `validation_thresholds` table.

## Mock mode

Set `OTTO_MOCK_MODE=true` (or omit credentials) to run the entire
pipeline locally with deterministic synthetic data. Production runs
require real credentials for eBay Browse API, Keepa, and a Playwright
session for the Amazon scraper.

## Future agents

Folders, interfaces, and placeholder lists exist for these so they can
be added later without refactoring. See `src/agents/discovery/futureAgents.ts`:

- Zik Category / Product / Competitor / Keyword / Sell-Through / Saturation
- Amazon Best Seller / Movers
- Keepa Rank Movement / Price Stability
- Walmart / Home Depot / Lowe's / Wayfair / AliExpress / Temu / TikTok Shop / Google Trends radars
- Adjacent / Complementary / Same Product Different Brand / Private Label Alternative
