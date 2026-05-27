# OTTO Manual QA Analysis

- **Generated**: 2026-05-27T04:28:39.970Z
- **Source**: `exports/otto_manual_qa_review_2026-05-26_v14_confirmation.csv`
- **Batch**: v1.4 confirmation limit=25

## Headline numbers

| Metric | Value |
| --- | ---:|
| rows in CSV | 9 |
| rows reviewed (would_list filled) | 9 |
| would_list yes | 7 |
| would_list no | 2 |
| would_list approval rate | 77.8% |
| asin_real yes rate | 100.0% |
| demand_makes_sense yes rate | 100.0% |
| low_risk yes rate | 100.0% |

## Rejection patterns

| Pattern | Count |
| --- | ---:|
| `too_many_similar_listings` | 2 |

## Rejected ASINs

- **B098QQ2B4B** [HappyPicnic, $17.98] HappyPicnic Waterproof Garden Kneeling Pad - 2" Thick Soft Foam Kneeling Mat for Gardeners  _(too many sellers on ebay)_
- **B0GHZNDHKP** [Grenebo, $17.99] Grenebo High-Density NBR Foam Garden Kneeling Pad, 1.6" Extra Thick Gardening Pads for Kne  _(too many sellers on ebay)_

## Recommendations

- Approval rate 77.8% meets the 70% target. Safe to scale --limit.
- Pattern "too_many_similar_listings" hit 2 times. Consider lowering MAX_SATURATION_QUALITY_RISK or tightening exact_or_similar / duplicate_ratio penalties in scoreSaturationQuality.
