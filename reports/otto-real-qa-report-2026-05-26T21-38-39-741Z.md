# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T22:09:07.816Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `0351b6f1-6445-4c17-bbcb-8067c43046a8`
- **export_batch_id**: `f22df9a5-31a3-4d07-8573-9b0d28319e83`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 50 |
| ASIN failed | 75 |
| Amazon source valid | 39 |
| Amazon source failed | 11 |
| demand passed | 31 |
| demand failed | 8 |
| compliance passed | 30 |
| compliance failed | 1 |
| business fit passed | 10 |
| business fit failed | 20 |
| cost calculated | 10 |
| final validated | 9 |
| final rejected | 1 |
| final validated before dedupe | 9 |
| duplicate ASINs removed | 0 |
| exported after dedupe | 9 |
| exported count | 9 |
| end-to-end pass rate | 7.2% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 37 |
| prime-likely pass (Prime/FBA signal trusted) | 2 |
| requires manual shipping review | 2 |
| rejected: DELIVERY_TOO_LONG | 1 |
| rejected: DELIVERY_UNCLEAR | 0 |

## Amazon resolver reliability

| Metric | Value |
| --- | ---:|
| total Amazon search attempts | 500 |
| successful search pages | 125 |
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
| products failed the competition gate (in rejection breakdown) | 15 |
| average competition_quality_score (exported) | 64 |
| high seller competition (>= 60) in exports | 9 |
| price compression (>= 50) in exports | 0 |
| exact-match saturation (>= 50) in exports | 2 |
| generic commodity titles in exports | 7 |
| borderline competition gate in exports | 9 |

Top competition rejection codes:
- `HIGH_DUPLICATE_MARKET`: 15


- **CSV export path**: `exports/otto-validated-2026-05-26T22-09-07-544Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 75 |
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
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_3
- brand: whillar
- amazon price: $23.99
- delivery days: 6
- sell within 30 days confidence: 85
- stagnation risk: 10
- policy risk: 0
- final validation score: 86

### [B0FBGHHYM7] Large Capacity 3-Layer Storage Box with Handle, Cantilever Portable Tackle Box & Craft Case Organizer, Folding Plastic Medicine Box for Sewing Supplies, Makeup, Nail, Hair Accessories (Pink)
- URL: https://www.amazon.com/Three-Layer-Multipurpose-Portable-Organizer-Accessories/dp/B0FBGHHYM7/ref=sr_1_1
- brand: Rainfordhoma
- amazon price: $20.58
- delivery days: 5
- sell within 30 days confidence: 79
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B098QQ2B4B] HappyPicnic Waterproof Garden Kneeling Pad - 2" Thick Soft Foam Kneeling Mat for Gardeners with Handle & Removable Cover, Knee Support for Bathing, Grey
- URL: https://www.amazon.com/HappyPicnic-Waterproof-Kneeling-Exercise-Planting/dp/B098QQ2B4B/ref=sr_1_1
- brand: HappyPicnic
- amazon price: $17.98
- delivery days: 5
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B0FK3K1228] 24QT Craft Storage Box with Removable Trays - Art Supply Organizer & Marker Organizer, Multi-Purpose Storage Bins with Lids for Playroom Storage, Board Game Storage & Craft Organizers and Storage
- URL: https://www.amazon.com/Multifunctional-Storage-Portable-Supplies-Organizers/dp/B0FK3K1228/ref=sr_1_1
- brand: Generic
- amazon price: $24.66
- delivery days: 5
- sell within 30 days confidence: 76
- stagnation risk: 25
- policy risk: 0
- final validation score: 81

### [B0FLJ569XQ] 64'' Garage Tool Organizer Wall Mount, 620lbs Heavy Duty Metal Storage Rack | Adjustable Hooks Garden Tool Organization System | Anti-Rust Shed Rack for Hanging Shovel, Rake, Broom, Snowboard
- URL: https://www.amazon.com/Lvoess-Organizer-Adjustable-Organization-Anti-Rust/dp/B0FLJ569XQ/ref=sr_1_1
- brand: Lvoess
- amazon price: $26.99
- delivery days: 5
- sell within 30 days confidence: 81
- stagnation risk: 25
- policy risk: 15
- final validation score: 80

### [B0GHZNDHKP] Grenebo High-Density NBR Foam Garden Kneeling Pad, 1.6" Extra Thick Gardening Pads for Kneeling, Ultra Soft Kneeling Pads for Gardening, Work, Exercise, Yoga, 17.3×11×1.6 in (2, Black)
- URL: https://www.amazon.com/Grenebo-High-Density-Kneeling-Gardening-17-3%C3%9711%C3%971-6/dp/B0GHZNDHKP/ref=sr_1_2
- brand: Grenebo
- amazon price: $17.99
- delivery days: 5
- sell within 30 days confidence: 83
- stagnation risk: 25
- policy risk: 0
- final validation score: 80

### [B0DTY91JWP] Tire Rack, Rolling Tire Storage Rack 60" X 59" X 21", Adjustable Metal Rolling Tire Rack for Indoor/Outdoor Use Tire Rack for Garage Warehouse, Also Be Used for Firewood Rack
- URL: https://www.amazon.com/OLIPIC-Rolling-Adjustable-Warehouse-Firewood/dp/B0DTY91JWP/ref=sr_1_2
- brand: OLIPIC
- amazon price: $95.75
- delivery days: 8
- sell within 30 days confidence: 73
- stagnation risk: 25
- policy risk: 0
- final validation score: 78

### [B0D6FP8CS2] YSSOA New Garden Kneeler and Seat, Foldable Kneeling Bench, Hold Up to 330lb, with Sturdy Soft EVA Foam Pad and 2 Tool Pouch for Gardening, Fishing, Camping, Green
- URL: https://www.amazon.com/YSSOA-2024-Garden-Kneeler-Seat/dp/B0D6FP8CS2/ref=sr_1_9
- brand: YSSOA
- amazon price: $32.99
- delivery days: 9
- sell within 30 days confidence: 72
- stagnation risk: 25
- policy risk: 0
- final validation score: 78

## Next action

9 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
