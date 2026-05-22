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
