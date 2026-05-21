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
npm run test:pipeline            # discover -> validate -> CSV (set OTTO_MOCK_MODE=true to skip live APIs)
```

The pipeline writes a CSV into `./exports/otto-validated-<timestamp>.csv`
and prints a summary line.

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
