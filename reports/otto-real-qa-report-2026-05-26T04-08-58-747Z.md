# OTTO Real QA Batch Report

- **Generated**: 2026-05-26T04:30:07.357Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `71d9708c-a680-474d-9a4c-72ec3ddd40c5`
- **export_batch_id**: `e2f660a1-ca0a-4190-a33e-a35db5bb1cdc`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 49 |
| ASIN failed | 76 |
| Amazon source valid | 41 |
| Amazon source failed | 8 |
| demand passed | 33 |
| demand failed | 8 |
| compliance passed | 32 |
| compliance failed | 1 |
| business fit passed | 23 |
| business fit failed | 9 |
| cost calculated | 23 |
| final validated | 22 |
| final rejected | 1 |
| final validated before dedupe | 22 |
| duplicate ASINs removed | 3 |
| exported after dedupe | 19 |
| exported count | 19 |
| end-to-end pass rate | 17.6% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 40 |
| prime-likely pass (Prime/FBA signal trusted) | 1 |
| requires manual shipping review | 1 |
| rejected: DELIVERY_TOO_LONG | 0 |
| rejected: DELIVERY_UNCLEAR | 0 |

- **CSV export path**: `exports/otto-validated-2026-05-26T04-30-07-170Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-26.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 76 |
| `LOW_DEMAND_SCORE` | 7 |
| `TOO_CHEAP` | 5 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 4 |
| `AMAZON_NOT_BUYABLE` | 2 |
| `BULKY_HIGH_TICKET_CAUTION` | 2 |
| `BUSINESS_FIT_FAILED` | 2 |
| `AMAZON_PRICE_MISSING` | 2 |
| `COMPLIANCE_HARD_BLOCK` | 1 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 1 |
| `DELIVERY_TOO_LONG` | 1 |

## Top passing products

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_3
- brand: whillar
- amazon price: $23.99
- delivery days: 4
- sell within 30 days confidence: 84
- stagnation risk: 10
- policy risk: 0
- final validation score: 86

### [B0BCJQ31XZ] BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer and Storage with Adjustable Spacers Portable Handled Art Supply Organizer Multipurpose Home Utility Box Organizer (Pink)
- URL: https://www.amazon.com/BTSKY-3-Layer-Organizer-Adjustable-Multipurpose/dp/B0BCJQ31XZ/ref=sr_1_4
- brand: BTSKY
- amazon price: $20.99
- delivery days: 4
- sell within 30 days confidence: 92
- stagnation risk: 25
- policy risk: 0
- final validation score: 85

### [B0F7TQQJ3B] RoseArt Multi-Layer Plastic Dividing Craft Storage Box - Portable Handled Art Supply Organizer, Utility, Tool, Medicine, Craft Box Clear - Made in U.S.A
- URL: https://www.amazon.com/RoseArt-Multi-Layer-Plastic-Dividing-Storage/dp/B0F7TQQJ3B/ref=sr_1_1
- brand: RoseArt
- amazon price: $13.29
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B0BVVDC3KH] WORKPRO Extra Thick Kneeling Pad, Soft NBR Foam Cushioning for Knee, Large Foam Kneeler Mat for Gardening, Bathing Baby, Exercise, Workout Supplies, 17.5 x 11 x 1.5 in, Black
- URL: https://www.amazon.com/WORKPRO-Kneeling-Cushioning-Gardening-Supplies/dp/B0BVVDC3KH/ref=sr_1_3
- brand: WORKPRO
- amazon price: $15.19
- delivery days: 4
- sell within 30 days confidence: 90
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B08QTNM1TJ] Comfy Extra Large Thick Waterproof Gardening Kneeling Pad Foam Kneeler Mat Garden Knee Pad Cushion for Gardening Planting Yard Work Prayer Yoga Mechanic Workout Baby Bath
- URL: https://www.amazon.com/Kneeling-Gardening-Planting-Mechanic-Exercise/dp/B08QTNM1TJ/ref=sr_1_1
- brand: Omixe
- amazon price: $12.96
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B0BXWLJQHR] Comfy Extra Large Thick Waterproof Gardening Kneeling Pad Foam Kneeler Mat Garden Knee Pad Cushion for Gardening Planting Yard Work Prayer Yoga Mechanic Workout Baby Bath
- URL: https://www.amazon.com/Omixe-Kneeling-Gardening-Planting-Mechanic/dp/B0BXWLJQHR/ref=sr_1_7
- brand: Omixe
- amazon price: $12.96
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B0CMCS65GB] HOOPLE Extra Thick Kneeling Pad, Soft Foam Kneeling Cushion, Waterproof Gardening Knee Pads, Lightweight Knee Mat for Bathing, Workout Supplies, Exercise Yoga, Garden Work Gifts 17.5 x 11 x 1 in, Black
- URL: https://www.amazon.com/HOOPLE-Kneeling-Waterproof-Gardening-Lightweight/dp/B0CMCS65GB/ref=sr_1_1
- brand: HOOPLE
- amazon price: $12.99
- delivery days: 4
- sell within 30 days confidence: 90
- stagnation risk: 25
- policy risk: 15
- final validation score: 82

### [B098QQ2B4B] HappyPicnic Waterproof Garden Kneeling Pad - 2" Thick Soft Foam Kneeling Mat for Gardeners with Handle & Removable Cover, Knee Support for Bathing, Grey
- URL: https://www.amazon.com/HappyPicnic-Waterproof-Kneeling-Exercise-Planting/dp/B098QQ2B4B/ref=sr_1_1
- brand: HappyPicnic
- amazon price: $17.98
- delivery days: 4
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B084R6JNNV] 7 Elements 4 Drawer Wooden Artist Storage Supply Box for Pastels, Pencils, Pens, Markers, Brushes and Tools
- URL: https://www.amazon.com/Elements-Beechwood-Storage-Pastels-Pencils/dp/B084R6JNNV/ref=sr_1_1
- brand: 7 Elements
- amazon price: $33.99
- delivery days: 4
- sell within 30 days confidence: 83
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B089B4XZM4] VIVO Under Desk 17 inch Cable Management Tray, Power Strip Holder, Cord Organizer, Wire Tamer for Office and Home, Black, DESK-AC06-1C
- URL: https://www.amazon.com/VIVO-Management-Holder-Organizer-DESK-AC06-1C/dp/B089B4XZM4/ref=sr_1_1
- brand: (none)
- amazon price: $19.99
- delivery days: 4
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 81

## Next action

22 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
