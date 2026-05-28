# OTTO Keepa Discovery Calibration

- **Generated**: 2026-05-28T04:23:12.202Z
- **Limit/profile**: 10
- **Repeat policy**: `allow_repeats` (lookback 30d)
- **Keepa endpoint**: Product Finder (`/query`) + `/product` (stats=90)

## Profile comparison

| Profile | rankImpr%% | price band | tokens | raw | ASIN-native | src valid | demand | compliance | biz fit | final (pre-dedupe) | exported | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `strict` | 20 | $12-$150 | 72 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| `balanced` | 10 | $10-$150 | 73 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| `broad` | 5 | $10-$200 | 73 | 6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | — |

## Profile: strict

- Tight rank movement + price band; safer categories only.
- discovery_run_id: `093f0e5c-8a68-43f7-9e71-68e93c6c514e`, export_batch_id: `f0e65806-d24d-4cc0-8d51-03d26722b290`
- Keepa tokens consumed: 72, tokens left: 3576

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 5
- `KEEPA_CATEGORY_EXCLUDED`: 1

Validation rejection breakdown:
- _(none)_

## Profile: balanced

- Moderate rank movement; safer categories only.
- discovery_run_id: `aee8de4a-56df-43ba-95fa-d4e3a41cc90f`, export_batch_id: `827db702-8be9-40e2-92d7-adac44c20005`
- Keepa tokens consumed: 73, tokens left: 3503

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 6

Validation rejection breakdown:
- _(none)_

## Profile: broad

- Loose rank movement + wider price band; leans on downstream gates.
- discovery_run_id: `57db8eaf-ef0c-4159-8237-b35d6472688f`, export_batch_id: `5d47d1e8-d8ff-4581-918d-c55e10242999`
- Keepa tokens consumed: 73, tokens left: 3430

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 6

Validation rejection breakdown:
- _(none)_
