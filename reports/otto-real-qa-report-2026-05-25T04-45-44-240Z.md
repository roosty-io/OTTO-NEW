# OTTO Real QA Batch Report

- **Generated**: 2026-05-25T05:05:53.349Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `5b77e35b-fb94-4c25-a85b-54bc5c94a938`
- **export_batch_id**: `64bfc231-5bf7-4caa-be42-e1b91a80f5d7`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 53 |
| ASIN failed | 72 |
| Amazon source valid | 44 |
| Amazon source failed | 9 |
| demand passed | 37 |
| demand failed | 7 |
| compliance passed | 35 |
| compliance failed | 2 |
| business fit passed | 25 |
| business fit failed | 10 |
| cost calculated | 25 |
| final validated | 25 |
| final rejected | 0 |
| final validated before dedupe | 25 |
| duplicate ASINs removed | 5 |
| exported after dedupe | 20 |
| exported count | 20 |
| end-to-end pass rate | 20.0% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 44 |
| prime-likely pass (Prime/FBA signal trusted) | 0 |
| requires manual shipping review | 0 |
| rejected: DELIVERY_TOO_LONG | 1 |
| rejected: DELIVERY_UNCLEAR | 0 |

- **CSV export path**: `exports/otto-validated-2026-05-25T05-05-53-177Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-25.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 72 |
| `TOO_CHEAP` | 6 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 5 |
| `LOW_DEMAND_SCORE` | 5 |
| `AMAZON_NOT_BUYABLE` | 3 |
| `BUSINESS_FIT_FAILED` | 3 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 2 |
| `COMPLIANCE_HARD_BLOCK` | 2 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 |
| `DELIVERY_TOO_LONG` | 1 |

## Top passing products

### [B0BCJQ31XZ] BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer and Storage with Adjustable Spacers Portable Handled Art Supply Organizer Multipurpose Home Utility Box Organizer (Pink)
- URL: https://www.amazon.com/BTSKY-3-Layer-Organizer-Adjustable-Multipurpose/dp/B0BCJQ31XZ/ref=sr_1_3
- brand: BTSKY
- amazon price: $20.99
- delivery days: 5
- sell within 30 days confidence: 92
- stagnation risk: 25
- policy risk: 0
- final validation score: 86

### [B0F7TQQJ3B] RoseArt Multi-Layer Plastic Dividing Craft Storage Box - Portable Handled Art Supply Organizer, Utility, Tool, Medicine, Craft Box Clear - Made in U.S.A
- URL: https://www.amazon.com/RoseArt-Multi-Layer-Plastic-Dividing-Storage/dp/B0F7TQQJ3B/ref=sr_1_1
- brand: RoseArt
- amazon price: $13.29
- delivery days: 5
- sell within 30 days confidence: 90
- stagnation risk: 25
- policy risk: 0
- final validation score: 85

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_3
- brand: whillar
- amazon price: $23.99
- delivery days: 5
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B07T9Z4NVP] Dimple Kneeling Pad, High Density Thick Foam Comfort Kneeling Mats for Gardening, Yoga Exercise, Garden Cushions, Knee Pads Black
- URL: https://www.amazon.com/Dimple-Kneeling-Kneelers-Gardening-Exercise/dp/B07T9Z4NVP/ref=sr_1_9
- brand: Dimple
- amazon price: $12.89
- delivery days: 4
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B0D6VS8BQT] Gonice Craft Cabinet Organizer, 24 Drawer Plastic Parts Cabinet, Tool Storage Box for Screws, Nuts and Small Parts
- URL: https://www.amazon.com/Gonice-Cabinet-Storage-Hardware-Organizer/dp/B0D6VS8BQT/ref=sr_1_10
- brand: Gonice
- amazon price: $24.99
- delivery days: 5
- sell within 30 days confidence: 86
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B08QTNM1TJ] Comfy Extra Large Thick Waterproof Gardening Kneeling Pad Foam Kneeler Mat Garden Knee Pad Cushion for Gardening Planting Yard Work Prayer Yoga Mechanic Workout Baby Bath
- URL: https://www.amazon.com/Kneeling-Gardening-Planting-Mechanic-Exercise/dp/B08QTNM1TJ/ref=sr_1_1
- brand: Omixe
- amazon price: $12.96
- delivery days: 4
- sell within 30 days confidence: 87
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B098QQ2B4B] HappyPicnic Waterproof Garden Kneeling Pad - 2" Thick Soft Foam Kneeling Mat for Gardeners with Handle & Removable Cover, Knee Support for Bathing, Grey
- URL: https://www.amazon.com/HappyPicnic-Waterproof-Kneeling-Exercise-Planting/dp/B098QQ2B4B/ref=sr_1_1
- brand: HappyPicnic
- amazon price: $17.98
- delivery days: 4
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

### [B084R6JNNV] 7 Elements 4 Drawer Wooden Artist Storage Supply Box for Pastels, Pencils, Pens, Markers, Brushes and Tools
- URL: https://www.amazon.com/Elements-Beechwood-Storage-Pastels-Pencils/dp/B084R6JNNV/ref=sr_1_1
- brand: 7 Elements
- amazon price: $33.99
- delivery days: 5
- sell within 30 days confidence: 84
- stagnation risk: 25
- policy risk: 0
- final validation score: 82

### [B0CMCS65GB] HOOPLE Extra Thick Kneeling Pad, Soft Foam Kneeling Cushion, Waterproof Gardening Knee Pads, Lightweight Knee Mat for Bathing, Workout Supplies, Exercise Yoga, Garden Work Gifts 17.5 x 11 x 1 in, Black
- URL: https://www.amazon.com/HOOPLE-Kneeling-Waterproof-Gardening-Lightweight/dp/B0CMCS65GB/ref=sr_1_1
- brand: HOOPLE
- amazon price: $12.99
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 25
- policy risk: 15
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

25 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
