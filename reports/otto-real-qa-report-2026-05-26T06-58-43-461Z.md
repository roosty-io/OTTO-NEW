# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T07:17:32.432Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `5eb00ee3-6de8-4047-8489-461cda71b552`
- **export_batch_id**: `d86c124c-40c2-432e-abfe-ea18ae594ee6`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 48 |
| ASIN failed | 77 |
| Amazon source valid | 42 |
| Amazon source failed | 6 |
| demand passed | 35 |
| demand failed | 7 |
| compliance passed | 34 |
| compliance failed | 1 |
| business fit passed | 2 |
| business fit failed | 32 |
| cost calculated | 2 |
| final validated | 2 |
| final rejected | 0 |
| final validated before dedupe | 2 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 2 |
| exported count | 2 |
| end-to-end pass rate | 1.6% |

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
| products failed the competition gate (in rejection breakdown) | 25 |
| average competition_quality_score (exported) | 68 |
| high seller competition (>= 60) in exports | 2 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 0 |
| generic commodity titles in exports | 0 |
| borderline competition gate in exports | 2 |

Top competition rejection codes:
- `HIGH_SELLER_COMPETITION`: 23
- `HIGH_DUPLICATE_MARKET`: 1
- `PRICE_COMPRESSED_MARKET`: 1


- **CSV export path**: `exports/otto-validated-2026-05-26T07-17-32-255Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 77 |
| `HIGH_SELLER_COMPETITION` | 23 |
| `LOW_DEMAND_SCORE` | 5 |
| `TOO_CHEAP` | 5 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 4 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `HIGH_STAGNATION_RISK` | 2 |
| `BUSINESS_FIT_FAILED` | 2 |
| `COMPLIANCE_HARD_BLOCK` | 1 |
| `HIGH_DUPLICATE_MARKET` | 1 |
| `PRICE_COMPRESSED_MARKET` | 1 |

## Top passing products

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_1
- brand: whillar
- amazon price: $23.99
- delivery days: 6
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B08GCJ9LHB] Goplus Garden Kneeler and Seat, Foldable Garden Bench for Kneeling & Sitting, Widened 8" EVA Soft Foam Pad, Heavy-Duty Garden Stool w/ 2 Large Tool Pouches, Gardening Gift for Women Men Seniors
- URL: https://www.amazon.com/Goplus-Foldable-Kneeler-Portable-Pouches/dp/B08GCJ9LHB/ref=sr_1_4
- brand: Goplus
- amazon price: $40.98
- delivery days: 7
- sell within 30 days confidence: 71
- stagnation risk: 25
- policy risk: 0
- final validation score: 78

## Next action

2 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
