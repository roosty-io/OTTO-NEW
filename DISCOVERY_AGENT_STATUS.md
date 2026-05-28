# OTTO Discovery Agent Status

_Audit date: 2026-05-28. Branch: `claude/keen-meitner-FT8xt`._

_Update 2026-05-28: **Keepa Rank Movement Discovery is now implemented**
(`npm run run:keepa-discovery`) — the first ASIN-native discovery source.
See `DISCOVERY_EXPANSION_PLAN.md` for the build it came from._

_Update 2026-05-28 (volume): **Keepa now runs multiple Product Finder
strategies** to raise candidate volume without touching any validation gate.
Strategies: `rank_drops_30d`, `rank_drops_90d`, `current_rank_only`,
`category_movers`, `price_band_movers`, `review_quality_movers`, and `all`
(default). Each is a distinct `/query` selection; their ASINs are unioned and
**deduped** (each ASIN keeps `primary_keepa_strategy`, `strategies_found`,
`strategy_count`, `best_discovery_score`). New flags:_
- `--strategy=all` _(default) or a single/comma-separated strategy name._
- `--max-keepa-tokens=N` _token guard (env `KEEPA_DISCOVERY_MAX_TOKENS_PER_RUN`,
  default 1000). A run whose **estimate** exceeds the budget is stopped before
  any token is spent; the run also self-limits against actual usage._
- `--force` _overrides the token guard (and, as before, the Amazon preflight)._

_Reports now show per-strategy products returned / accepted / rejected, filter
reasons by strategy, duplicate ASINs across strategies, final unique
ASIN-native candidates, and the strategy that produced each exported product.
`calibrate:keepa-discovery` compares a profile×strategy matrix and prints a
recommended profile/strategy. Use the `exploratory` profile (widest,
diagnostics-only — never the default export path) when maximizing volume while
debugging coverage. Example:_

```
npm run run:keepa-discovery -- --profile=exploratory --strategy=all --limit=10 --preflight-amazon
```

## TL;DR

- **Real discovery sources: `eBay Keyword Discovery` and
  `Keepa Rank Movement`.** eBay runs in `npm run run:real-qa`; Keepa
  runs in `npm run run:keepa-discovery` (ASIN-native — bypasses the
  resolver bottleneck).
- **The rest are placeholders.** Some have partially-real
  *clients* (Keepa API, Amazon Playwright) but **no discovery agent**
  wired to them.
- The next bottleneck is candidate **volume + diversity**, and the
  single biggest funnel loss is **`ASIN_NOT_RESOLVED` (103 of 172
  rejections in the latest real batch ≈ 60%)** — i.e. eBay listings
  that never resolve to a buyable Amazon ASIN. This strongly favors
  **ASIN-native discovery sources** (Keepa / Amazon) that skip the
  lossy eBay→ASIN resolution step.

## Legend

- **Status**: `real` (runs against live data in the pipeline) /
  `partial` (client exists & partly works, but no discovery agent) /
  `placeholder` (named/stubbed only) / `mock` (only returns canned data).
- **Complexity**: low / medium / high build effort.
- **Value**: expected lift in *validated* products (not just raw
  candidates), given the ASIN-resolution bottleneck.

## Summary table

| Agent | Status | Source / tool | Credentials | Code file | Output table | Test cmd | In `run:real-qa`? | Complexity | Value |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| eBay Keyword Discovery | **real** | eBay Browse API | `EBAY_CLIENT_ID`+`EBAY_CLIENT_SECRET` (or `EBAY_OAUTH_TOKEN`) | `src/agents/discovery/EbayKeywordDiscoveryAgent.ts` | `raw_candidates` | `npm run test:ebay-demand` (client), `npm run run:real-qa` (e2e) | **Yes** | — (done) | baseline |
| Zik Keyword Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | client only: `src/clients/zikBrowserClient.ts` (`getKeywordStats`) | `raw_candidates` + `source_signals` | none | No | high | high |
| Zik Product Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | client only: `zikBrowserClient.ts` (`searchProducts`) | `raw_candidates` + `source_signals` | none | No | high | high |
| Zik Competitor Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | none (no client method yet) | `raw_candidates` + `source_signals` | none | No | high | medium-high |
| Zik Category Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | client only: `zikBrowserClient.ts` (`getCategoryStats`) | `source_signals` / `category_performance_scores` | none | No | high | medium |
| Zik Sell-Through Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | none | `source_signals` (enriches `ebay_demand_checks`) | none | No | high | medium |
| Zik Saturation Discovery | placeholder | Zik Analytics (browser) | `ZIK_USERNAME`+`ZIK_PASSWORD` | none | `source_signals` (feeds competition gate) | none | No | high | medium |
| Keepa Rank Movement | **real** | Keepa API (`/query` + `/product`) | `KEEPA_API_KEY` (+ eBay for demand) | `src/agents/discovery/KeepaRankMovementDiscoveryAgent.ts` | `raw_candidates` + `product_opportunities` (ASIN-native) | `npm run test:keepa-discovery` / `npm run run:keepa-discovery` | **Yes** (`run:keepa-discovery`) | medium (done) | **high** |
| Keepa Price Stability | placeholder (client **partial**) | Keepa API | `KEEPA_API_KEY` | client: `keepaClient.ts`; no agent | `source_signals` (enriches BusinessFit) | none | No | medium | medium |
| Amazon Best Sellers | placeholder (infra **real**) | Amazon Best Sellers pages | Playwright browser, **no Amazon login** | infra: `src/clients/amazonBrowserClient.ts` (real); no agent | `raw_candidates` (ASIN-native) | none | No | medium | **high** |
| Amazon Movers | placeholder (infra **real**) | Amazon Movers & Shakers | Playwright browser, no login | infra: `amazonBrowserClient.ts`; no agent | `raw_candidates` (ASIN-native) | none | No | medium | medium-high |
| Amazon Related Products | placeholder (infra **real**) | Amazon PDP "related" carousels | Playwright browser, no login | infra: `amazonBrowserClient.ts`; no agent | `raw_candidates` + `opportunity_relationships` | none | No | medium | high |
| Walmart Trends | placeholder | Walmart trending pages | Playwright browser | none | `raw_candidates` | none | No | medium-high | medium |
| Home Depot Trends | placeholder | HomeDepot.com | Playwright browser | none | `raw_candidates` | none | No | medium-high | medium |
| Wayfair Trends | placeholder | Wayfair.com | Playwright browser | none | `raw_candidates` | none | No | medium-high | medium |
| TikTok Shop Trends | placeholder | TikTok Shop | Playwright browser | none | `raw_candidates` | none | No | high | medium |
| Google Trends | placeholder | Google Trends | **None** | none | `source_signals` (keyword seeds) | none | No | medium | medium |

> The 22-name superset (incl. Lowe's / AliExpress / Temu radars and the
> relationship explorers — Adjacent / Complementary / Same-Product-
> Different-Brand / Private-Label-Alternative) lives in
> `src/agents/discovery/futureAgents.ts` as string names only.

## Per-agent detail

### eBay Keyword Discovery — **real**

- **What it does**: queries the eBay Browse API for each seed keyword,
  validates each raw item (title / URL / category present), writes
  survivors to `raw_candidates`, and emits `agent_logs`.
- **File**: `src/agents/discovery/EbayKeywordDiscoveryAgent.ts`.
- **Output**: `raw_candidates` (one row per accepted eBay item).
- **Wired into**: `run:real-qa`, `run-real-ebay-test`, `run-test-pipeline`.
- **Missing**: nothing functionally; it is the baseline. Its limitation
  is structural — eBay listings must then be resolved to an Amazon ASIN,
  and ~60% die there (`ASIN_NOT_RESOLVED`).

### Zik (Keyword / Product / Competitor / Category / Sell-Through / Saturation) — **placeholder**

- **Client**: `src/clients/zikBrowserClient.ts` is a stub. In mock mode
  it returns canned rows; in real mode it logs "not implemented" and
  returns empty. Interface methods: `searchProducts`, `getKeywordStats`,
  `getCategoryStats`. No `close`-managed Playwright session, no login.
- **Missing for all Zik agents**:
  1. Playwright login + persisted storage-state for `app.zik-analytics.com`.
  2. Page scrapers for the Keyword / Product Research / Competitor /
     Category screens (Zik has **no public API**).
  3. Selector-resilient parsers (third-party SaaS UI → brittle).
  4. The discovery agent classes themselves + pipeline wiring.
- **Value**: high for *eBay-demand-aligned* keywords/products, but note
  Zik-discovered products are eBay-side and still funnel through the
  lossy eBay→ASIN resolver.

### Keepa Rank Movement / Price Stability — **placeholder agent, partial client**

- **Client**: `src/clients/keepaClient.ts` is **partially real** —
  `getProduct(asin)` calls the live Keepa `/product` endpoint with
  `KEEPA_API_KEY` (present in `.env`) and returns rank/buy-box data.
- **Missing**: a discovery endpoint (`/deal`, `/bestsellers`, or
  `/query`), Keepa token-cost accounting, and the discovery agent.
- **Why high value**: Keepa is **ASIN-native** — it yields Amazon ASINs
  directly, skipping the eBay→ASIN resolution step that kills ~60% of
  current candidates. API-based ⇒ no captcha, deterministic, low risk.

### Amazon Best Sellers / Movers / Related Products — **placeholder agent, real infra**

- **Infra**: `src/clients/amazonBrowserClient.ts` is a **real, working
  Playwright client** (used today for ASIN resolution + source-page
  validation). It already handles browser lifecycle, retries, malformed-
  page classification, and PDP extraction — **no Amazon login**.
- **Missing**: best-sellers / movers / related-carousel page scrapers
  and the discovery agent classes. The hard part (reliable Amazon
  browsing) is already solved.
- **Why high value**: also **ASIN-native**; Related Products additionally
  expands from products we already validated (adjacency/diversity) and
  can populate `opportunity_relationships`.

### Cross-marketplace radars (Walmart / Home Depot / Wayfair / TikTok Shop / Google Trends) — **placeholder**

- No clients exist. Each needs a bespoke Playwright scraper (Google
  Trends needs none / can use its CSV/pseudo-API and is free).
- These mostly produce **keywords or non-Amazon products**, so they feed
  the eBay-keyword / ASIN-resolution path rather than bypassing it →
  lower near-term leverage than Keepa/Amazon, despite trend value.

## Recommendation (summary)

Implement **ASIN-native discovery first** to attack the
`ASIN_NOT_RESOLVED` bottleneck and raise validated-product volume:

1. **Keepa Rank Movement** — lowest effort (client half-built, key
   present, API-based/low-risk), ASIN-native, high value.
2. **Amazon Best Sellers + Related Products** — reuses the real
   Playwright client, ASIN-native, no new credentials.
3. **Zik Keyword Discovery** — highest eBay-demand alignment but the
   most build effort + brittleness, and still feeds the lossy resolver.

See `DISCOVERY_EXPANSION_PLAN.md` for the full build specs.
