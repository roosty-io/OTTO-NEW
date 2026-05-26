# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T19:37:32.502Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=10 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `63b80528-323e-46c0-ac6f-808421fd4c23`
- **export_batch_id**: `95c12905-a4f6-4ecb-8593-9f35027ebdca`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 50 |
| ASIN resolved | 21 |
| ASIN failed | 29 |
| Amazon source valid | 18 |
| Amazon source failed | 3 |
| demand passed | 13 |
| demand failed | 5 |
| compliance passed | 13 |
| compliance failed | 0 |
| business fit passed | 1 |
| business fit failed | 12 |
| cost calculated | 1 |
| final validated | 1 |
| final rejected | 0 |
| final validated before dedupe | 1 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 1 |
| exported count | 1 |
| end-to-end pass rate | 2.0% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 18 |
| prime-likely pass (Prime/FBA signal trusted) | 0 |
| requires manual shipping review | 0 |
| rejected: DELIVERY_TOO_LONG | 0 |
| rejected: DELIVERY_UNCLEAR | 0 |

## Amazon resolver reliability

| Metric | Value |
| --- | ---:|
| total Amazon search attempts | 200 |
| successful search pages | 50 |
| MALFORMED_PAGE count | 0 |
| MALFORMED_PAGE recovered after retry | 0 |
| CAPTCHA_OR_BLOCK count | 0 |
| TIMEOUT count | 0 |
| EMPTY_RESULTS count | 0 |
| final ASIN_NOT_RESOLVED candidates | 0 |
| resolver success rate (pages OK / attempts) | 25.0% |

## Competition / saturation

| Metric | Value |
| --- | ---:|
| products failed the competition gate (in rejection breakdown) | 11 |
| average competition_quality_score (exported) | 74 |
| high seller competition (>= 60) in exports | 1 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 0 |
| generic commodity titles in exports | 1 |
| borderline competition gate in exports | 1 |

Top competition rejection codes:
- `HIGH_SELLER_COMPETITION`: 9
- `COMPETITION_GATE_FAILED`: 1
- `HIGH_DUPLICATE_MARKET`: 1


- **CSV export path**: `exports/otto-validated-2026-05-26T19-37-32-317Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 29 |
| `HIGH_SELLER_COMPETITION` | 9 |
| `LOW_DEMAND_SCORE` | 4 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `COMPETITION_GATE_FAILED` | 1 |
| `HIGH_DUPLICATE_MARKET` | 1 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 1 |
| `BUSINESS_FIT_FAILED` | 1 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 1 |

## Top passing products

### [B0DZC7TZNL] Klutch Garage Overhead Storage Rack with Adjustable Height, 48in.L x 24in.D, 23in.–37in.H
- URL: https://www.amazon.com/Klutch-Garage-Overhead-Wall-Storage/dp/B0DZC7TZNL/ref=sr_1_1
- brand: Klutch
- amazon price: $49.99
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 25
- policy risk: 0
- final validation score: 86

## Next action

1 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
