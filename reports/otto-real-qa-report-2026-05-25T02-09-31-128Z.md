# OTTO Real QA Batch Report

- **Generated**: 2026-05-25T02:19:10.224Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=10 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `36c2139a-21aa-4687-9c34-3f0bfe691a92`
- **export_batch_id**: `41f1829b-cc59-4283-a7ad-a6eb6d87537c`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 50 |
| ASIN resolved | 26 |
| ASIN failed | 24 |
| Amazon source valid | 22 |
| Amazon source failed | 4 |
| demand passed | 17 |
| demand failed | 5 |
| compliance passed | 15 |
| compliance failed | 2 |
| cost calculated | 15 |
| final validated | 14 |
| final rejected | 1 |
| final validated before dedupe | 14 |
| duplicate ASINs removed | 1 |
| exported after dedupe | 13 |
| exported count | 13 |
| end-to-end pass rate | 28.0% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 20 |
| prime-likely pass (Prime/FBA signal trusted) | 2 |
| requires manual shipping review | 2 |
| rejected: DELIVERY_TOO_LONG | 0 |
| rejected: DELIVERY_UNCLEAR | 0 |

- **CSV export path**: `exports/otto-validated-2026-05-25T02-19-10-033Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-25.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 24 |
| `LOW_DEMAND_SCORE` | 5 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 2 |
| `COMPLIANCE_HARD_BLOCK` | 2 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `DELIVERY_TOO_LONG` | 1 |

## Top passing products

### [B0BCJQ31XZ] BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer and Storage with Adjustable Spacers Portable Handled Art Supply Organizer Multipurpose Home Utility Box Organizer (Pink)
- URL: https://www.amazon.com/BTSKY-3-Layer-Organizer-Adjustable-Multipurpose/dp/B0BCJQ31XZ/ref=sr_1_3
- brand: BTSKY
- amazon price: $20.99
- delivery days: 4
- sell within 30 days confidence: 92
- stagnation risk: 25
- policy risk: 0
- final validation score: 87

### [B0D2X29NGL] HOOPLE Kneeling Pad for Gardening, Lightweight Foam Knee Cushion for Garden, Bath, Yoga & Exercise, Waterproof Comfort Kneeling Mat for Home, Garage & Outdoor Work, Black 14.6 x 11.5 x 0.7 Inch
- URL: https://www.amazon.com/HOOPLE-Kneeling-Gardening-Waterproof-Lightweight/dp/B0D2X29NGL/ref=sr_1_1
- brand: HOOPLE
- amazon price: $9.99
- delivery days: 4
- sell within 30 days confidence: 91
- stagnation risk: 25
- policy risk: 0
- final validation score: 86

### [B0D6VS8BQT] Gonice Craft Cabinet Organizer, 24 Drawer Plastic Parts Cabinet, Tool Storage Box for Screws, Nuts and Small Parts
- URL: https://www.amazon.com/Gonice-Cabinet-Storage-Hardware-Organizer/dp/B0D6VS8BQT/ref=sr_1_1
- brand: Gonice
- amazon price: $24.99
- delivery days: 4
- sell within 30 days confidence: 87
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_2
- brand: whillar
- amazon price: $23.99
- delivery days: 4
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B0DZC6CPNB] Klutch Overhead Garage Storage Rack — Adjustable Height, 96in.L x 48in.D x 23–37in.H
- URL: https://www.amazon.com/Klutch-Gladiator-Overhead-Garage-Storage/dp/B0DZC6CPNB/ref=sr_1_1
- brand: Klutch
- amazon price: $124.99
- delivery days: 4
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B0DS1QSHJL] Extra Thick Garden Kneeling Pad - Foam Kneeling Pads for Gardening, Work & Exercise - Water-Resistant Knee Mat with Shock Absorbent Cushions for Baby Bath & Yoga, 17.2x11x1.5in, Black
- URL: https://www.amazon.com/Extra-Thick-Garden-Kneeling-Water-Resistant/dp/B0DS1QSHJL/ref=sr_1_1
- brand: fitply
- amazon price: $10.99
- delivery days: 7
- sell within 30 days confidence: 80
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B0FK3K1228] 24QT Craft Storage Box with Removable Trays - Art Supply Organizer & Marker Organizer, Multi-Purpose Storage Bins with Lids for Playroom Storage, Board Game Storage & Craft Organizers and Storage
- URL: https://www.amazon.com/Multifunctional-Storage-Portable-Supplies-Organizers/dp/B0FK3K1228/ref=sr_1_1
- brand: Generic
- amazon price: $24.66
- delivery days: 4
- sell within 30 days confidence: 74
- stagnation risk: 25
- policy risk: 0
- final validation score: 79

### [B0F1YL7C2T] Cable Management Under Desk, 【Up to 15 Cord】【Enhanced Wire Holder】 Cord Organizer, Adjustable Hook and Loop Cable Ties, Home Office Essentials, Cable Hider Clips Under Table, 20 Pair
- URL: https://www.amazon.com/Management-Cord%E3%80%91%E3%80%90Enhanced-Organizer-Adjustable-Reusable/dp/B0F1YL7C2T/ref=sr_1_6
- brand: fansto
- amazon price: $9.99
- delivery days: 4
- sell within 30 days confidence: 86
- stagnation risk: 25
- policy risk: 15
- final validation score: 79

### [B0GHZNDHKP] Grenebo High-Density NBR Foam Garden Kneeling Pad, 1.6" Extra Thick Gardening Pads for Kneeling, Ultra Soft Kneeling Pads for Gardening, Work, Exercise, Yoga, 17.3×11×1.6 in (2, Black)
- URL: https://www.amazon.com/Grenebo-High-Density-Kneeling-Gardening-17-3%C3%9711%C3%971-6/dp/B0GHZNDHKP/ref=sr_1_2
- brand: Grenebo
- amazon price: $20.99
- delivery days: 4
- sell within 30 days confidence: 78
- stagnation risk: 25
- policy risk: 0
- final validation score: 79

### [B0DTY91JWP] Tire Rack, Rolling Tire Storage Rack 60" X 59" X 21", Adjustable Metal Rolling Tire Rack for Indoor/Outdoor Use Tire Rack for Garage Warehouse, Also Be Used for Firewood Rack
- URL: https://www.amazon.com/OLIPIC-Rolling-Adjustable-Warehouse-Firewood/dp/B0DTY91JWP/ref=sr_1_2
- brand: OLIPIC
- amazon price: $95.75
- delivery days: 8
- sell within 30 days confidence: 73
- stagnation risk: 25
- policy risk: 0
- final validation score: 78

## Next action

14 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
