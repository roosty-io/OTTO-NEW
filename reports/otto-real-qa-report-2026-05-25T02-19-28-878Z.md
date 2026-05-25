# OTTO Real QA Batch Report

- **Generated**: 2026-05-25T02:41:52.798Z
- **Status**: completed
- **Command**: `npm run run:real-qa -- --limit=25 --keywords="under sink organizer,garage storage rack,desk cable organizer,garden kneeling pad,craft storage box"`
- **discovery_run_id**: `18c19bd0-c6d6-4821-a6fd-841c8261d98d`
- **export_batch_id**: `9d3ccb46-4325-4f56-b847-5d905caca37b`

## Stage counts

| Stage | Count |
| --- | --- |
| raw candidates | 125 |
| ASIN resolved | 57 |
| ASIN failed | 68 |
| Amazon source valid | 48 |
| Amazon source failed | 9 |
| demand passed | 41 |
| demand failed | 7 |
| compliance passed | 38 |
| compliance failed | 3 |
| cost calculated | 38 |
| final validated | 37 |
| final rejected | 1 |
| final validated before dedupe | 37 |
| duplicate ASINs removed | 8 |
| exported after dedupe | 29 |
| exported count | 29 |
| end-to-end pass rate | 29.6% |

## Shipping gate

| Outcome | Count |
| --- | --- |
| shipping pass (clear & within window) | 47 |
| prime-likely pass (Prime/FBA signal trusted) | 1 |
| requires manual shipping review | 1 |
| rejected: DELIVERY_TOO_LONG | 1 |
| rejected: DELIVERY_UNCLEAR | 0 |

- **CSV export path**: `exports/otto-validated-2026-05-25T02-41-52-570Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-25.csv`

## Rejection breakdown

| Code | Count |
| --- | --- |
| `ASIN_NOT_RESOLVED` | 68 |
| `LOW_DEMAND_SCORE` | 6 |
| `BUNDLE_OR_MULTIPACK_EXCLUDED` | 5 |
| `AMAZON_NOT_BUYABLE` | 3 |
| `COMPLIANCE_HARD_BLOCK` | 3 |
| `DELIVERY_TOO_LONG` | 2 |
| `LOW_SELL_WITHIN_30_DAYS_CONFIDENCE` | 1 |

## Top passing products

### [B0C98KGM5M] OALCQ 24 Grids Plastic Organizer Box With Dividers Clear Craft Storage Bead Organizer Box Earring Travel Pill Jewelry Organizers Storage Boxes Screw Seed Small Parts Hair Tie
- URL: https://www.amazon.com/Plastic-Organizer-Dividers-Storage-Earring/dp/B0C98KGM5M/ref=sr_1_8
- brand: OALCQ
- amazon price: $5.99
- delivery days: 4
- sell within 30 days confidence: 94
- stagnation risk: 25
- policy risk: 0
- final validation score: 88

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

### [B0D4HSNWWR] KADS Bead Storage Organizer Box with 28 Grids and Removable Dividers - Plastic Container Tray for Craft, Jewelry and Earrings (Clear)
- URL: https://www.amazon.com/KADS-Storage-Organizer-Removable-Dividers/dp/B0D4HSNWWR/ref=sr_1_10
- brand: KADS
- amazon price: $5.99
- delivery days: 4
- sell within 30 days confidence: 89
- stagnation risk: 10
- policy risk: 0
- final validation score: 85

### [B0F7TQQJ3B] RoseArt Multi-Layer Plastic Dividing Craft Storage Box - Portable Handled Art Supply Organizer, Utility, Tool, Medicine, Craft Box Clear - Made in U.S.A
- URL: https://www.amazon.com/RoseArt-Multi-Layer-Plastic-Dividing-Storage/dp/B0F7TQQJ3B/ref=sr_1_1
- brand: RoseArt
- amazon price: $13.29
- delivery days: 4
- sell within 30 days confidence: 90
- stagnation risk: 25
- policy risk: 0
- final validation score: 85

### [B0BVVDC3KH] WORKPRO Extra Thick Kneeling Pad, Soft NBR Foam Cushioning for Knee, Large Foam Kneeler Mat for Gardening, Bathing Baby, Exercise, Workout Supplies, 17.5 x 11 x 1.5 in, Black
- URL: https://www.amazon.com/WORKPRO-Kneeling-Cushioning-Gardening-Supplies/dp/B0BVVDC3KH/ref=sr_1_3
- brand: WORKPRO
- amazon price: $15.99
- delivery days: 4
- sell within 30 days confidence: 88
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B0BXWLJQHR] Comfy Extra Large Thick Waterproof Gardening Kneeling Pad Foam Kneeler Mat Garden Knee Pad Cushion for Gardening Planting Yard Work Prayer Yoga Mechanic Workout Baby Bath
- URL: https://www.amazon.com/Omixe-Kneeling-Gardening-Planting-Mechanic/dp/B0BXWLJQHR/ref=sr_1_10
- brand: Omixe
- amazon price: $12.96
- delivery days: 4
- sell within 30 days confidence: 87
- stagnation risk: 25
- policy risk: 0
- final validation score: 84

### [B0D6VS8BQT] Gonice Craft Cabinet Organizer, 24 Drawer Plastic Parts Cabinet, Tool Storage Box for Screws, Nuts and Small Parts
- URL: https://www.amazon.com/Gonice-Cabinet-Storage-Hardware-Organizer/dp/B0D6VS8BQT/ref=sr_1_1
- brand: Gonice
- amazon price: $24.99
- delivery days: 4
- sell within 30 days confidence: 88
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

### [B0B6RCKQBS] Parts Screws Storage Organizer, Plastic Hardware Art Craft Small Tool Parts Component Organizer Drawer Box 25 Drawers (Black)
- URL: https://www.amazon.com/Storage-Organizer-Plastic-Hardware-Component/dp/B0B6RCKQBS/ref=sr_1_3
- brand: whillar
- amazon price: $23.99
- delivery days: 4
- sell within 30 days confidence: 85
- stagnation risk: 25
- policy risk: 0
- final validation score: 83

## Next action

37 product(s) validated. Open the manual QA CSV and target a >= 70% would_list_yes_no approval before scaling.
