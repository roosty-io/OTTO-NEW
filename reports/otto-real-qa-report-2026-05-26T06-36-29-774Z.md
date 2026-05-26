# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T06:55:51.743Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `45d02890-9f06-4182-8d03-d39b686fee0b`
- **export_batch_id**: `7465f183-e4a6-4a19-b18e-90ae470546f9`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 48 |
| ASIN failed | 77 |
| Amazon source valid | 42 |
| Amazon source failed | 6 |
| demand passed | 34 |
| demand failed | 8 |
| compliance passed | 33 |
| compliance failed | 1 |
| business fit passed | 0 |
| business fit failed | 33 |
| cost calculated | 0 |
| final validated | 0 |
| final rejected | 0 |
| final validated before dedupe | 0 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 0 |
| exported count | 0 |
| end-to-end pass rate | 0.0% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 41 |
| prime-likely pass (Prime/FBA signal trusted) | 1 |
| requires manual shipping review | 1 |
| rejected: DELIVERY_TOO_LONG | 0 |
| rejected: DELIVERY_UNCLEAR | 0 |

## Competition / saturation

| Metric | Value |
| --- | ---:|
| products failed the competition gate (in rejection breakdown) | 29 |
| average competition_quality_score (exported) | 0 |
| high seller competition (>= 60) in exports | 0 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 0 |
| generic commodity titles in exports | 0 |
| borderline competition gate in exports | 0 |

Top competition rejection codes:
- `HIGH_DUPLICATE_MARKET`: 28
- `COMPETITION_GATE_FAILED`: 1


- **CSV export path**: `exports/otto-validated-2026-05-26T06-55-51-571Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 77 |
| `HIGH_DUPLICATE_MARKET` | 28 |
| `LOW_DEMAND_SCORE` | 6 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 4 |
| `TOO_CHEAP` | 4 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `HIGH_STAGNATION_RISK` | 2 |
| `COMPLIANCE_HARD_BLOCK` | 1 |
| `COMPETITION_GATE_FAILED` | 1 |

## Top passing products

_(no products passed all gates this run)_
## Next action

Compliance passed but the final validation gate rejected everything. Inspect the rejection breakdown and check final-validation thresholds in src/config/thresholds.ts.
