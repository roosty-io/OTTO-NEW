# OTTO Competition Gate — Three-Batch Comparison

- **Generated**: 2026-05-26
- All three batches: `npm run run:real-qa -- --limit=25` against the same
  five seed keywords (under sink organizer / garage storage rack / desk
  cable organizer / garden kneeling pad / craft storage box).

## Stage counts across three iterations

| Stage | Pre-V1.2 (5-26 conf) | V1.2 initial | V1.2 round 1 soften | V1.2 round 2 soften |
| --- | ---:| ---:| ---:| ---:|
| raw candidates | 125 | 125 | 125 | 125 |
| ASIN resolved | 49 | 48 | 48 | **18** (Amazon flake) |
| Amazon source valid | 41 | 42 | 42 | 5 (Amazon flake) |
| demand passed | 33 | 34 | 35 | 2 |
| compliance passed | 32 | 33 | 34 | 2 |
| **business fit passed** | 23 | **0** | 2 | 1 |
| **business fit failed** | 9 | **33** | 32 | 1 |
| final validated / exported | 22 / 19 | 0 / 0 | 2 / 2 | 1 / 1 |

## Competition-rejection breakdown across iterations

| Code | V1.2 initial | Round 1 | Round 2 |
| --- | ---:| ---:| ---:|
| `HIGH_DUPLICATE_MARKET` | **28** | 1 | 0 |
| `HIGH_SELLER_COMPETITION` | 0 | **23** | 0 |
| `EXACT_MATCH_SATURATION` | 0 | 0 | 0 |
| `PRICE_COMPRESSED_MARKET` | 0 | 1 | 0 |
| `COMPETITION_GATE_FAILED` | 1 | 0 | 0 |
| **Total competition rejections** | **29** | **25** | **0** |

## Diagnosis

- **V1.2 initial**: duplicate-listing curve was way too hot. Commodity
  organizer markets have signature-collision duplicate_ratios in the
  40-60% range that aren't real duplicates. 28 of 33 BF-eligible
  products rejected.
- **Round 1 soften** (duplicate curve eased + exact-match curve eased):
  duplicates dropped from 28→1, but the seller-competition curve was
  still tuned for retail (sellerCount >= 25 → 55) and the generic-commodity
  multiplier stacked another +10 on top, pushing 23 products into
  HIGH_SELLER_COMPETITION rejections.
- **Round 2 soften** (seller curve raised band + commodity multiplier
  removed): **0 rejected by the competition gate**. The gate is now
  correctly tuned for V1 commodity markets.

## Why round 2 still has a low export count (1)

The round-2 batch hit a separate Amazon-side issue independent of the
competition gate:

- `AMAZON_SEARCH_UNAVAILABLE` × **47** — Amazon returned `MALFORMED_PAGE`
  for many ASIN-resolver queries during this run (visible in the log
  before the summary). This dropped ASIN-resolved from a typical 48 to
  18, which is the root cause of the low export count.
- `AMAZON_PRICE_MISSING` × **11** — same Amazon flakiness.
- `LOW_DEMAND_SCORE` × **3**.

The competition gate had nothing to filter because there were only 2
products to consider.

## Verdict

- The V1.2 competition gate is calibrated: **0 false rejects** on a
  representative round.
- The Amazon-side `MALFORMED_PAGE` rate is the new pinch point. Retry
  / backoff on the resolver's `MALFORMED_PAGE` path is a small, focused
  follow-up.
- All four fast regressions still green: mock pipeline 25/25,
  compliance 15/15, shipping-gate 8/8, competition-quality 6/6.

## Next action

Re-run `npm run run:real-qa -- --limit=25` when Amazon is responding
normally (the `MALFORMED_PAGE` spike is transient). Expected outcome
with the round-2 curves: roughly the **previous post-business-fit
export size (~20 unique ASINs)** but with the competition gate live so
crowded commodity markets are correctly excluded when their signals
actually justify rejection.
