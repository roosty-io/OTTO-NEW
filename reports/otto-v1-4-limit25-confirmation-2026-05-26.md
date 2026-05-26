# OTTO V1.4 Confirmation Batch (limit=25)

- **Generated**: 2026-05-26
- **Tuning commit**: `adb96c8` (V1.4 combined-evidence competition gate + healthy-competition rescue)
- **Prior V1.4 smoke (limit=10)**: 5 exports, 100% manual QA approval (5/5 would_list_yes) - cleared the 70% scale threshold.
- **Confirmation batch**:
  - run: `npm run run:real-qa -- --limit=25`
  - export: `exports/otto-validated-2026-05-26T22-09-07-544Z.csv`
  - QA report: `reports/otto-real-qa-report-2026-05-26T21-38-39-741Z.md`
  - manual QA CSV: `exports/otto_manual_qa_review_2026-05-26.csv`
  - discovery_run_id: `0351b6f1-6445-4c17-bbcb-8067c43046a8`
  - export_batch_id: `f22df9a5-31a3-4d07-8573-9b0d28319e83`

## Stage funnel

| Stage | Count |
| --- | ---:|
| raw candidates | **125** |
| ASIN resolved | 50 (40%) |
| ASIN failed | 75 |
| Amazon source valid | 39 |
| Amazon source failed | 11 |
| demand passed | 31 |
| demand failed | 8 |
| compliance passed | 30 |
| compliance failed | 1 |
| **business fit passed** | **10** |
| business fit failed | 20 |
| cost calculated | 10 |
| final validated (pre-dedupe) | 9 |
| final rejected | 1 |
| duplicate ASINs removed | 0 |
| **exported after dedupe** | **9** |
| end-to-end pass rate | **7.2%** |

## Amazon resolver reliability

| Metric | Value |
| --- | ---:|
| total Amazon search attempts | 500 |
| successful search pages | 125 |
| **MALFORMED_PAGE count** | **0** |
| MALFORMED_PAGE recovered after retry | 0 |
| CAPTCHA_OR_BLOCK count | 0 |
| TIMEOUT count | 0 |
| EMPTY_RESULTS count | 0 |
| final resolver failures | 0 |
| resolver success rate (pages OK / attempts) | 25.0% _(see note)_ |

> Note: "resolver success rate" denominator is `attempts` (4 generated
> queries × 125 candidates = 500 attempts) and numerator is
> `successPagesOk` (125 candidates that returned hits on at least one
> query). 0 transient failures across all 500 attempts — the V1.3
> resolver-reliability work is holding.

## Shipping gate

| Outcome | Count |
| --- | ---:|
| `pass` (clear & within window) | 37 |
| `prime_likely_pass` (Prime/FBA trusted) | 2 |
| `shipping_review_required = true` | 2 |
| rejected `DELIVERY_TOO_LONG` | 1 |
| rejected `DELIVERY_UNCLEAR` | 0 |

## Competition gate breakdown

| Metric | Value |
| --- | ---:|
| products failed competition gate | 15 |
| avg `competition_quality_score` (exports) | 64 (borderline-healthy) |
| exports with high seller competition (≥60) | 9 (soft penalty, not hard reject) |
| exports with price compression (≥50) | 0 |
| exports with exact-match saturation (≥50) | 2 |
| exports flagged generic commodity | 7 |

| Competition rejection code | Count |
| --- | ---:|
| `HIGH_DUPLICATE_MARKET` | 15 (truly-saturated combo) |
| `HIGH_SELLER_COMPETITION` (sole-cause) | **0** |

V1.4 recalibration holding: zero `HIGH_SELLER_COMPETITION` sole-cause
rejections — all hard fails came from the explicit truly-saturated
combo (`dup_ratio ≥ 50%` AND `exact_or_similar_count ≥ 20`).

## Business-fit rejection breakdown

| Code | Count |
| --- | ---:|
| `HIGH_DUPLICATE_MARKET` | 15 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 5 |
| `LOW_DEMAND_SCORE` | 5 |
| `AMAZON_PRICE_MISSING` | 3 |
| `TOO_CHEAP` | 3 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `DELIVERY_TOO_LONG` | 2 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 2 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 |
| `HIGH_STAGNATION_RISK` | 1 |
| `COMPLIANCE_HARD_BLOCK` | 1 |
| `BUSINESS_FIT_FAILED` | 1 |

## Top 10 exported products

| Rank | ASIN | Title | Brand | Price | Delivery | 30d conf | Final |
| ---:| --- | --- | --- | ---:| ---:| ---:| ---:|
| 1 | B0DZC7TZNL | Klutch Garage Overhead Storage Rack (48"L) | Klutch | $49.99 | 4d | 88 | 86 |
| 2 | B0B6RCKQBS | Parts Screws Storage Organizer | whillar | $23.99 | 6d | 85 | 86 |
| 3 | B0FBGHHYM7 | 3-Layer Storage Box with Handle | Rainfordhoma | $20.58 | 5d | 79 | 82 |
| 4 | B098QQ2B4B | HappyPicnic Waterproof Garden Kneeling Pad | HappyPicnic | $17.98 | 5d | 85 | 82 |
| 5 | B0FK3K1228 | 24QT Craft Storage Box | Generic | $24.66 | 5d | 76 | 81 |
| 6 | B0FLJ569XQ | 64" Garage Tool Organizer Wall Mount | Lvoess | $26.99 | 5d | 81 | 80 |
| 7 | B0GHZNDHKP | Grenebo Garden Kneeling Pad | Grenebo | $17.99 | 5d | 83 | 80 |
| 8 | B0DTY91JWP | Tire Rack 60"x59"x21" (Rolling) | OLIPIC | $95.75 | 8d | 73 | 78 |
| 9 | B0D6FP8CS2 | YSSOA Garden Kneeler & Seat (foldable bench) | YSSOA | $32.99 | 9d | 72 | 78 |

## Bulky / return-risk review

These products carry bulky / oversized / return-shipping signals.
They are NOT auto-rejected (only `B0DZC6CPNB` was hard-blocked because
it exceeded the `$100 + bulky` rule). The rest passed business fit
but should be human-reviewed before listing.

### Passed business fit, bulky / oversized cues present

| ASIN | Title (truncated) | Price | bulkiness_risk | reason_codes | business_fit | final |
| --- | --- | ---:| ---:| --- | ---:| ---:|
| **B0DTY91JWP** | Tire Rack 60"x59"x21" Rolling (Tire / Firewood) | $95.75 | **55** | `OVERSIZED_STORAGE_RISK`, `RETURN_SHIPPING_RISK` ×2 | 80 | **78** |
| B0D6FP8CS2 | YSSOA Garden Kneeler & Seat (foldable bench) | $32.99 | 30 | `RETURN_SHIPPING_RISK` | 85 | 78 |
| B0DZC7TZNL | Klutch Garage Overhead Rack (48"L x 24"D) | $49.99 | 15 | — | 88 | 86 |
| B0FLJ569XQ | 64" Garage Tool Organizer Wall Mount (heavy duty) | $26.99 | 15 | — | 87 | 80 |
| B0FBGHHYM7 | 3-Layer Storage Box with Handle | $20.58 | 15 | — | 84 | 82 |

> **B0DTY91JWP** (Tire Rack) has the highest residual risk: 60"x59"x21"
> with delivery 8d. It passed business fit but the operator should
> verify on manual review (bulky tire-rack returns can be costly).
> **B0D6FP8CS2** (YSSOA Kneeler Bench) has 9-day delivery which is at
> the edge of the 10-day window — also worth a manual check.

### Hard-rejected as bulky (correctly)

| ASIN | Title | Price | bulkiness_risk | Reason |
| --- | --- | ---:| ---:| --- |
| B0DZC6CPNB | Klutch Overhead Rack 96"L × 48"D × 23-37"H | **$124.99** | 65 | `BULKY_HIGH_TICKET_CAUTION` (price > $100 ceiling with bulky cues) |

The operator previously manually flagged the **$124.99** Klutch rack
in an earlier batch. V1.4 correctly hard-rejects it while allowing
the smaller **$49.99** version (B0DZC7TZNL) through. Target hit.

## Acceptance criteria

| Criterion | Result |
| --- | --- |
| Manual QA import / analyze works | ✓ (V1.4 smoke: 5/5 = 100%) |
| Smoke approval ≥ 70% → run confirmation | ✓ (smoke 100%, confirmation completed) |
| Confirmation report shows resolver reliability | ✓ (500 attempts / 0 malformed / 0 captcha / 0 timeout) |
| Confirmation report shows competition gate behavior | ✓ (15 hard fails, all truly-saturated combo; 0 sole-cause `HIGH_SELLER_COMPETITION`) |
| Confirmation report shows bulky / return-risk products | ✓ (5 listed above, 1 correctly hard-rejected) |
| No duplicate ASINs exported | ✓ (9 rows / 9 unique ASINs / `uniq -d` empty) |
| No mock data in real QA mode | ✓ |
| Existing tests still pass | ✓ (pipeline 25/25, compliance 15/15, shipping-gate 8/8, competition 6/6, retry 6/6) |

## Next action

1. Fill the reviewer columns in `exports/otto_manual_qa_review_2026-05-26.csv`
   (now 9 rows from the limit=25 confirmation).
2. Run:

   ```bash
   npm run import:manual-qa  -- --file=exports/otto_manual_qa_review_2026-05-26.csv \
                                 --batch-label="v1.4 confirmation limit=25"
   npm run analyze:manual-qa -- --file=exports/otto_manual_qa_review_2026-05-26.csv \
                                 --batch-label="v1.4 confirmation limit=25"
   ```

3. **If approval ≥ 70%**: two consecutive batches (smoke 100% + this
   confirmation) clear the gate. Safe to scale to `--limit=50`, or
   build the internal dashboard.
4. **If approval < 70%**: the analyzer's pattern report will indicate
   which axis needs further tuning. The most likely candidate from
   this run is the Tire Rack (B0DTY91JWP) — review its `would_list`
   answer carefully before changing thresholds.
