# OTTO Manual QA Analysis — Post-Shipping-Gate limit=25 Batch

- **Generated**: 2026-05-25
- **Batch label**: post-shipping-gate QA limit=25
- **CSV**: `exports/otto_manual_qa_review_2026-05-25.csv` (29 rows)
- **Source of reviewer data**: operator-reported aggregate; the
  per-product reviewer columns in the CSV are still blank, so this
  document captures only what the operator confirmed at review time.
  Once the CSV is filled, `npm run analyze:manual-qa --file=...` will
  produce the per-product analysis automatically.

## Operator-reported numbers

| Metric | Value |
| --- | ---:|
| products reviewed | 29 |
| `would_list_yes_no = yes` | 19 |
| `would_list_yes_no = no` | 10 |
| **would-list approval rate** | **65.5%** |
| `asin_real_yes_no = yes` | 29 of 29 (100%) |
| `demand_makes_sense_yes_no = yes` | 29 of 29 (100%) |
| `low_risk_yes_no = yes` | 24 of 29 (~82.8%) |

## Verdict

**HOLD** — would-list approval rate **65.5%** is below the 70% target.
**Do not scale to `--limit=50`** until a tuned re-run clears 70%.

The signal split is informative: ASIN resolution (100%) and demand
relevance (100%) are working correctly. The dropouts are clustered on
**business fit**, not technical correctness — which is exactly what the
new `BusinessFitAgent` is designed to catch.

## Reasons captured from operator notes

The operator reported four clusters of rejection reasons:

1. **too cheap** — products priced below the practical floor where eBay
   margin disappears after fees.
2. **too many similar listings** — products where demand is real but
   the eBay market is already saturated with near-identical listings.
3. **Vero brand / too cheap** — Fiskars surfaced; brand-caution should
   block it before downstream gates spend cycles on it.
4. **bulky / high-ticket garage rack concern** — bulky high-ticket
   items carry oversized-shipping and return-shipping risk.

## Threshold + scoring changes applied (this commit)

- **MIN_AMAZON_PRICE_DEFAULT** = `$10`; **MIN_AMAZON_PRICE_STRICT** = `$12`.
- **MAX_BULKY_PRICE_WITHOUT_HIGH_CONFIDENCE** = `$100`.
- **MIN_BUSINESS_FIT_SCORE** = `70` (hard gate via `FinalValidationAgent`).
- **MAX_BULKINESS_RISK_SCORE** = `60`.
- **MAX_SATURATION_QUALITY_RISK** = `60`.
- **Fiskars** added to `BRAND_ENTRIES` as `hardBlock=true` so
  `ComplianceRiskCouncil.VeroBrandAgent` rejects it before BusinessFit
  even runs.
- New `BusinessFitAgent` runs between compliance and cost. It computes
  `business_fit_score` from `price_quality`, `saturation_quality`,
  `bulkiness_risk`, `brand_caution`, and a learned
  `manual_qa_pattern_penalty`, then emits one of: `TOO_CHEAP`,
  `LOW_PRICE_QUALITY`, `PRICE_BELOW_BUSINESS_FIT_THRESHOLD`,
  `TOO_MANY_SIMILAR_LISTINGS`, `HIGH_DUPLICATE_MARKET`,
  `SATURATED_GENERIC_PRODUCT`, `LOW_DIFFERENTIATION`,
  `BULKY_HIGH_TICKET_CAUTION`, `OVERSIZED_STORAGE_RISK`,
  `RETURN_SHIPPING_RISK`, `BRAND_CAUTION_MATCH`, `BUSINESS_FIT_FAILED`.
- `FinalValidationAgent` now requires `business_fit_passed=true` AND
  `business_fit_score >= MIN_BUSINESS_FIT_SCORE`, and weights
  `business_fit_score` at 20% of the composite final validation score.

## Next action

Re-run `npm run run:real-qa -- --limit=25` against the same five seed
keywords and compare exported count, would-list approval rate target
estimate, and the new business-fit rejection-code breakdown.  If the
re-run sustains ≥ 70% would-list approval over two consecutive
batches, scale to `--limit=50`.
