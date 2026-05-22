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
- **Amazon browser automation is not yet implemented.**  Every candidate
  is recorded with `AMAZON_RESOLUTION_NOT_IMPLEMENTED` / `AMAZON_VALIDATION_UNAVAILABLE`
  in `rejected_products`.  Nothing reaches the validated CSV in real mode
  until a real Playwright Amazon client is wired up - the pipeline will
  not pretend it has.
- Exits with code `2` if `EBAY_CLIENT_ID` / `EBAY_CLIENT_SECRET` (or
  `EBAY_OAUTH_TOKEN`) are missing.

The pipeline writes a CSV into `./exports/otto-validated-<timestamp>.csv`
and prints a stage-by-stage summary.

### Required env vars

| Mode               | Required                                                    |
|--------------------|-------------------------------------------------------------|
| Mock               | (none) - set `OTTO_MOCK_MODE=true`                          |
| Real eBay discovery| `EBAY_CLIENT_ID` + `EBAY_CLIENT_SECRET`, or `EBAY_OAUTH_TOKEN` |
| Persistence        | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (otherwise the |
|                    | client falls back to an in-memory stub)                     |

### Real-mode limitations (V1)

- **Amazon source validation** uses a placeholder Playwright client.
  Until that lands, ASIN resolution and Amazon stock / price / delivery
  checks return `null` and the candidate is rejected with a clear reason
  rather than fabricated data.
- **Keepa** and **Zik** clients are also placeholders - their data is
  not yet folded into demand or compliance scoring.
- **Demand scoring** still works against real eBay data, but until the
  Zik signals are wired in the `sell_within_30_days_confidence` /
  `stagnation_risk_score` heuristics are based only on Browse-API
  competitor listings.

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
