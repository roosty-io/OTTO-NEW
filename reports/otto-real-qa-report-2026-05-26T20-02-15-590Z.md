# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T20:14:53.715Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=10 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `c029df6f-8564-4cc5-894c-1853a0ab1790`
- **export_batch_id**: `ac81386b-f2ae-4456-978a-ade1011d91d9`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 50 |
| ASIN resolved | 24 |
| ASIN failed | 26 |
| Amazon source valid | 19 |
| Amazon source failed | 5 |
| demand passed | 13 |
| demand failed | 6 |
| compliance passed | 13 |
| compliance failed | 0 |
| business fit passed | 4 |
| business fit failed | 9 |
| cost calculated | 4 |
| final validated | 4 |
| final rejected | 0 |
| final validated before dedupe | 4 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 4 |
| exported count | 4 |
| end-to-end pass rate | 8.0% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 19 |
| prime-likely pass (Prime/FBA signal trusted) | 0 |
| requires manual shipping review | 0 |
| rejected: DELIVERY_TOO_LONG | 1 |
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
| products failed the competition gate (in rejection breakdown) | 7 |
| average competition_quality_score (exported) | 70 |
| high seller competition (>= 60) in exports | 4 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 0 |
| generic commodity titles in exports | 3 |
| borderline competition gate in exports | 4 |

Top competition rejection codes:
- `HIGH_DUPLICATE_MARKET`: 7


- **CSV export path**: `exports/otto-validated-2026-05-26T20-14-53-523Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 26 |
| `HIGH_DUPLICATE_MARKET` | 7 |
| `LOW_DEMAND_SCORE` | 4 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 2 |
| `HIGH_STAGNATION_RISK` | 1 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 |
| `DELIVERY_TOO_LONG` | 1 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 1 |
| `BUSINESS_FIT_FAILED` | 1 |
| `AMAZON_NOT_BUYABLE` | 1 |
| `AMAZON_PRICE_MISSING` | 1 |

## Top passing products

### [B0DZC7TZNL] Klutch Garage Overhead Storage Rack with Adjustable Height, 48in.L x 24in.D, 23in.–37in.H
- URL: https://www.amazon.com/Klutch-Garage-Overhead-Wall-Storage/dp/B0DZC7TZNL/ref=sr_1_1
- brand: Klutch
- amazon price: $49.99
- delivery days: 4
- sell within 30 days confidence: 88
- stagnation risk: 25
- policy risk: 0
- final validation score: 86

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_2
- brand: whillar
- amazon price: $23.99
- delivery days: 6
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B0FBGHHYM7] Large Capacity 3-Layer Storage Box with Handle, Cantilever Portable Tackle Box & Craft Case Organizer, Folding Plastic Medicine Box for Sewing Supplies, Makeup, Nail, Hair Accessories (Pink)
- URL: https://www.amazon.com/Three-Layer-Multipurpose-Portable-Organizer-Accessories/dp/B0FBGHHYM7/ref=sr_1_1
- brand: Rainfordhoma
- amazon price: $20.58
- delivery days: 5
- sell within 30 days confidence: 79
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B0FK3K1228] 24QT Craft Storage Box with Removable Trays - Art Supply Organizer & Marker Organizer, Multi-Purpose Storage Bins with Lids for Playroom Storage, Board Game Storage & Craft Organizers and Storage
- URL: https://www.amazon.com/Multifunctional-Storage-Portable-Supplies-Organizers/dp/B0FK3K1228/ref=sr_1_1
- brand: Generic
- amazon price: $24.66
- delivery days: 5
- sell within 30 days confidence: 75
- stagnation risk: 25
- policy risk: 0
- final validation score: 81

## Next action

4 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
