# OTTO Keepa Discovery Calibration

- **Generated**: 2026-05-28T04:26:31.445Z
- **Limit/profile**: 10
- **Repeat policy**: `allow_repeats` (lookback 30d)
- **Keepa endpoint**: Product Finder (`/query`) + `/product` (stats=90)

## Profile comparison

| Profile | rankImpr%% | price band | tokens | raw | ASIN-native | src valid | demand | compliance | biz fit | final (pre-dedupe) | exported | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `strict` | 20 | $12-$150 | 78 | 6 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| `balanced` | 10 | $10-$150 | 78 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | — |
| `broad` | 5 | $10-$200 | 78 | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | — |

## Profile: strict

- Tight rank movement + price band; safer categories only.
- discovery_run_id: `b4482ad8-3bb9-4bfc-a41a-c15908d83f5e`, export_batch_id: `124f5093-9074-4ae8-b1b3-5ce7883f8e08`
- Keepa tokens consumed: 78, tokens left: 3457

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 5

Validation rejection breakdown:
- `AMAZON_PAGE_UNAVAILABLE`: 1

Amazon source-validation failures (sample):

| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B0DW2BYTVP` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |

## Profile: balanced

- Moderate rank movement; safer categories only.
- discovery_run_id: `00105715-0919-4f22-a674-1f4d443db23f`, export_batch_id: `f2f371ea-2b05-4b18-8f0f-1dd7d0ea9424`
- Keepa tokens consumed: 78, tokens left: 3379

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 4

Validation rejection breakdown:
- `AMAZON_PAGE_UNAVAILABLE`: 2

Amazon source-validation failures (sample):

| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B0F8P55L5D` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `B0DW2BYTVP` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |

## Profile: broad

- Loose rank movement + wider price band; leans on downstream gates.
- discovery_run_id: `78c7eed3-285b-4c0e-97aa-b1921b412edd`, export_batch_id: `441ca9de-8a91-4bea-89aa-c22b2817147d`
- Keepa tokens consumed: 78, tokens left: 3301

Keepa filter losses:
- `KEEPA_RANK_IMPROVEMENT_TOO_LOW`: 4

Validation rejection breakdown:
- `AMAZON_PAGE_UNAVAILABLE`: 2

Amazon source-validation failures (sample):

| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B0F8P55L5D` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `B0DW2BYTVP` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
