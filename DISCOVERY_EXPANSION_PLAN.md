# OTTO Discovery Expansion Plan

_Audit date: 2026-05-28. Planning only — nothing implemented in this pass._
_Companion to `DISCOVERY_AGENT_STATUS.md`._

## The bottleneck this plan targets

Today OTTO has exactly **one real discovery source** (eBay Keyword
Discovery). Every candidate it finds is an **eBay listing** that must
then be resolved to a buyable **Amazon ASIN**. In the latest real batch,
the dominant rejection was **`ASIN_NOT_RESOLVED` — 103 of 172
rejections (~60%)**. So the cheapest way to increase *validated* product
volume is not "more eBay keywords" — it is **discovery sources that are
already ASIN-native**, skipping the resolution step entirely.

That insight orders the recommendations below: **Keepa and Amazon
(ASIN-native) before Zik (eBay-native)** — even though the operator's
stated preference leans Zik-first. The tradeoff is called out explicitly
in "First implementation recommendation" so the call is yours.

Constraints honored: no change to validation gates, cross-batch
filtering, AutoDS/listing/SaaS/auth scope. New agents only *feed*
`raw_candidates`; the existing ASIN-resolution → Amazon source →
demand → compliance → business-fit → final → export chain is unchanged.

---

## Recommended next 3 discovery agents

### 1. Keepa Rank Movement Discovery  ← **build first**

- **Purpose**: surface Amazon products whose sales rank is improving
  (rising demand) within OTTO-relevant categories, as ASIN-native
  candidates that bypass eBay→ASIN resolution.
- **Exact input**:
  - category list (Keepa `category` ids, seeded from the same themes as
    today's keywords: storage/organization, garden, garage, craft),
  - rank-drop threshold + window (e.g. rank improved over 30/90 days),
  - `limit` per category (mirrors `--limit` ceiling).
- **Exact output**: `ProductCandidate[]` written to `raw_candidates`
  with `source='keepa_rank_movement'`, `marketplace='amazon'`,
  `asin` populated in `raw_payload`, `priceHint` from buy-box,
  `discoveryScore` derived from rank-improvement magnitude.
- **Required credentials**: `KEEPA_API_KEY` (already in `.env`).
- **Target tables**: `raw_candidates` (primary); optional
  `source_signals` rows for rank/price history snapshots.
- **API approach**: extend `src/clients/keepaClient.ts` with a
  `findRankMovers({categoryId, daysBack, limit})` method using Keepa's
  `/deal` or `/bestsellers`/`/query` endpoint. **Must implement Keepa
  token-cost accounting** (each call costs tokens; throttle + back off
  on `429`/low-token responses). No browser, no captcha.
- **Estimated difficulty**: **medium** (client is half-built; the work
  is one new endpoint + token budgeting + the agent class).
- **Risk level**: **low** (deterministic API; no scraping/blocking).
- **Expected candidate volume**: high and tunable (hundreds/run by
  category); ASIN-native so ~all survive resolution.
- **Expected quality**: high — rank-movement is a real demand signal and
  products arrive pre-qualified as buyable Amazon ASINs.
- **Pipeline hand-off**: emits the same `ProductCandidate` shape as
  `EbayKeywordDiscoveryAgent`. Because the ASIN is already known, the
  `BasicAmazonAsinResolverAgent` can treat it as a high-confidence direct
  match (resolver still runs for the source-page validation hand-off).
- **Test command (to add)**: `npm run test:keepa-rank-movement`
  (unit: mock Keepa payload → expected candidates; no live tokens).
- **Acceptance criteria**:
  - With `KEEPA_API_KEY` set, the agent returns ≥1 ASIN-native candidate
    per seeded category and writes `raw_candidates` rows.
  - Token-cost guard prevents runaway calls (caps requests/run; backs
    off on low tokens).
  - Candidates flow through `run:real-qa` and at least some reach
    `validated_products`.
  - Zero impact on existing gates / cross-batch filtering.

### 2. Amazon Best Sellers + Related Products Discovery

- **Purpose**: two ASIN-native sources sharing the existing Playwright
  client — (a) category Best-Sellers leaders, (b) "Products related to
  this item" carousels off ASINs OTTO already validated (adjacency &
  diversity).
- **Exact input**:
  - Best Sellers: category/bestseller URLs + `limit`.
  - Related: a seed set of ASINs (e.g. recent `validated_products` for
    the run's themes) + depth (1 hop) + `limit`.
- **Exact output**: `raw_candidates` with
  `source='amazon_best_sellers'` / `'amazon_related'`,
  `marketplace='amazon'`, ASIN in payload; Related also writes
  `opportunity_relationships` (parent ASIN → related ASIN,
  `relationship_type='related_carousel'`).
- **Required credentials**: **none** (Playwright browser, **no Amazon
  login** — same posture as the resolver today).
- **Target tables**: `raw_candidates`, `opportunity_relationships`
  (Related only).
- **Browser approach**: add `getBestSellers(categoryUrl, limit)` and
  `getRelatedProducts(asin, limit)` to `src/clients/amazonBrowserClient.ts`,
  reusing its existing browser lifecycle, retry, and
  malformed-page/captcha classification. Throttle to stay polite.
- **Estimated difficulty**: **medium** (the hard part — reliable headless
  Amazon browsing — already works; this is page-specific extraction).
- **Risk level**: **medium** (Amazon scraping ⇒ captcha/block risk and
  added page load; mitigated by the existing retry/backoff classifier
  and conservative rate limits).
- **Expected candidate volume**: high (Best Sellers); medium but
  high-relevance (Related).
- **Expected quality**: high — ASIN-native, and Related stays close to
  already-validated winners.
- **Pipeline hand-off**: same `ProductCandidate` contract; ASIN known up
  front, so resolution is a near-pass-through to source-page validation.
- **Test command (to add)**: `npm run test:amazon-discovery`
  (unit against saved HTML fixtures; no live fetch).
- **Acceptance criteria**:
  - Best Sellers returns ≥N ASIN-native candidates for a seeded category.
  - Related returns adjacency candidates for a seed ASIN and writes
    `opportunity_relationships`.
  - Respects rate limits; no new captcha-handling regressions in the
    shared client.
  - Candidates reach `validated_products` via the unchanged pipeline.

### 3. Zik Keyword Discovery

- **Purpose**: pull **eBay-demand-validated** keywords/products from Zik
  Analytics (sell-through, average price, competition) to widen and
  better-target the eBay discovery surface.
- **Exact input**: seed keywords/categories + filters (min sell-through,
  price band, max competition) + `limit`.
- **Exact output**: `raw_candidates` with `source='zik_keyword'`,
  `marketplace='ebay'`, plus `source_signals` rows carrying Zik metrics
  (sell-through %, avg price, competition) for downstream demand scoring.
- **Required credentials**: `ZIK_USERNAME` + `ZIK_PASSWORD` (present).
- **Target tables**: `raw_candidates`, `source_signals`.
- **Browser approach**: build a **real** `zikBrowserClient` —
  Playwright login to `app.zik-analytics.com` with persisted
  storage-state, then scrape the Keyword/Product Research screens (Zik
  has **no public API**). Selector-resilient parsing + re-login on
  session expiry.
- **Estimated difficulty**: **high** (login + session persistence +
  brittle third-party-UI scraping + parsers + agent).
- **Risk level**: **medium-high** (UI changes break selectors; login/2FA
  friction; ToS/rate considerations).
- **Expected candidate volume**: medium-high.
- **Expected quality**: high *for eBay demand alignment*, **but**
  Zik candidates are eBay-side and still funnel through the lossy
  eBay→ASIN resolver — so net validated-product lift is gated by that
  step.
- **Pipeline hand-off**: same `ProductCandidate` contract; Zik metrics
  ride along in `source_signals` to enrich `EbayDemandScoringAgent`.
- **Test command (to add)**: `npm run test:zik-discovery`
  (unit against saved Zik HTML fixtures; live login excluded from CI).
- **Acceptance criteria**:
  - Authenticated client returns parsed rows for a seed keyword.
  - Agent writes `raw_candidates` + `source_signals`.
  - Graceful handling of login failure / empty results (no crash, clear
    log).
  - Candidates reach `validated_products` via the unchanged pipeline.

---

## First implementation recommendation

**Build Keepa Rank Movement first.**

Rationale (audit-driven):
1. **Lowest effort that ships real value** — the Keepa client already
   makes live API calls and `KEEPA_API_KEY` is configured; remaining work
   is one discovery endpoint + token budgeting + the agent.
2. **Directly attacks the #1 funnel loss** — it is ASIN-native, so its
   candidates skip the `ASIN_NOT_RESOLVED` step that kills ~60% of
   today's pipeline.
3. **Lowest risk** — pure API, no captcha/scraping fragility, easy to
   unit-test with mocked payloads.

**Then** Amazon Best Sellers + Related Products (also ASIN-native,
reuses the proven Playwright client, no credentials), and **then** Zik
Keyword Discovery for eBay-demand breadth.

### Note on the stated preference (Zik-first)

The operator's likely preference was Zik Keyword → Zik Competitor/Product
→ Amazon Related / Keepa. That ordering is reasonable **if the priority
is eBay-demand-aligned breadth** rather than raw validated-product
throughput. The cost of Zik-first: highest build effort and brittleness,
and it does **not** relieve the ASIN-resolution bottleneck. If the goal
this iteration is "more validated products per run with least effort,"
Keepa-first wins; if the goal is "best eBay-demand targeting regardless
of build cost," Zik-first is defensible. Recommend Keepa-first; happy to
proceed Zik-first on your call.

### Suggested env (when these are built — not added yet)

```
# Keepa discovery
KEEPA_DISCOVERY_CATEGORIES=...        # category ids
KEEPA_RANK_LOOKBACK_DAYS=30
KEEPA_MAX_TOKENS_PER_RUN=...          # token budget guard

# Amazon discovery
AMAZON_DISCOVERY_MAX_PAGES=...        # politeness cap

# Zik discovery
# (reuses ZIK_USERNAME / ZIK_PASSWORD already in .env)
```

Each agent must remain **opt-in** (off by default, enabled per-run like
`OTTO_REAL_EBAY_DISCOVERY`) so existing real-QA behavior is unchanged
until explicitly turned on.
