# OTTO Manual QA Analysis

- **Generated**: 2026-05-26T04:05:42.513Z
- **Source**: `exports/otto_manual_qa_review_2026-05-25_filled.csv`
- **Batch**: post-business-fit limit=25

## Headline numbers

| Metric | Value |
| --- | ---:|
| rows in CSV | 20 |
| rows reviewed (would_list filled) | 20 |
| would_list yes | 17 |
| would_list no | 3 |
| would_list approval rate | 85.0% |
| asin_real yes rate | 100.0% |
| demand_makes_sense yes rate | 100.0% |
| low_risk yes rate | 100.0% |

## Rejection patterns

| Pattern | Count |
| --- | ---:|
| `too_many_similar_listings` | 3 |

## Rejected ASINs

- **B089B4XZM4** [, $19.99] VIVO Under Desk 17 inch Cable Management Tray, Power Strip Holder, Cord Organizer, Wire Ta  _(too many sellers)_
- **B0CMCS65GB** [HOOPLE, $12.99] HOOPLE Extra Thick Kneeling Pad, Soft Foam Kneeling Cushion, Waterproof Gardening Knee Pad  _(too many sellers)_
- **B0BCJQ31XZ** [BTSKY, $20.99] BTSKY 3-Layer Plastic Dividing Storage Box Craft Organizer and Storage with Adjustable Spa  _(too many sellers)_

## Recommendations

- Approval rate 85.0% meets the 70% target. Safe to scale --limit.
- Pattern "too_many_similar_listings" hit 3 times. Consider lowering MAX_SATURATION_QUALITY_RISK or tightening exact_or_similar / duplicate_ratio penalties in scoreSaturationQuality.
