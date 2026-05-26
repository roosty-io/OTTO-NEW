# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T07:28:55.692Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `c1daff71-22b1-4de3-a883-ff4faed73fa4`
- **export_batch_id**: `7a7a1575-1255-4cfb-b2bb-0994fd885115`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 18 |
| ASIN failed | 107 |
| Amazon source valid | 5 |
| Amazon source failed | 13 |
| demand passed | 2 |
| demand failed | 3 |
| compliance passed | 2 |
| compliance failed | 0 |
| business fit passed | 1 |
| business fit failed | 1 |
| cost calculated | 1 |
| final validated | 1 |
| final rejected | 0 |
| final validated before dedupe | 1 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 1 |
| exported count | 1 |
| end-to-end pass rate | 0.8% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 5 |
| prime-likely pass (Prime/FBA signal trusted) | 0 |
| requires manual shipping review | 0 |
| rejected: DELIVERY_TOO_LONG | 0 |
| rejected: DELIVERY_UNCLEAR | 0 |

## Competition / saturation

| Metric | Value |
| --- | ---:|
| products failed the competition gate (in rejection breakdown) | 0 |
| average competition_quality_score (exported) | 69 |
| high seller competition (>= 60) in exports | 1 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 0 |
| generic commodity titles in exports | 1 |
| borderline competition gate in exports | 1 |


- **CSV export path**: `exports/otto-validated-2026-05-26T07-28-55-522Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 57 |
| `AMAZON_SEARCH_UNAVAILABLE` | 47 |
| `AMAZON_PRICE_MISSING` | 11 |
| `LOW_DEMAND_SCORE` | 3 |
| `LOW_CONFIDENCE_ASIN_MATCH` | 3 |
| `AMAZON_NOT_BUYABLE` | 1 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 1 |

## Top passing products

### [B0DTY91JWP] Tire Rack, Rolling Tire Storage Rack 60" X 59" X 21", Adjustable Metal Rolling Tire Rack for Indoor/Outdoor Use Tire Rack for Garage Warehouse, Also Be Used for Firewood Rack
- URL: https://www.amazon.com/OLIPIC-Rolling-Adjustable-Warehouse-Firewood/dp/B0DTY91JWP/ref=sr_1_2
- brand: OLIPIC
- amazon price: $95.75
- delivery days: 8
- sell within 30 days confidence: 72
- stagnation risk: 25
- policy risk: 0
- final validation score: 78

## Next action

1 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
