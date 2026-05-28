# OTTO Keepa Discovery Calibration

- **Generated**: 2026-05-28T04:21:52.072Z
- **Limit/profile**: 6
- **Repeat policy**: `allow_repeats` (lookback 30d)
- **Keepa endpoint**: Product Finder (`/query`) + `/product` (stats=90)

## Profile comparison

| Profile | rankImpr%% | price band | tokens | raw | ASIN-native | src valid | demand | compliance | biz fit | final (pre-dedupe) | exported | error |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `strict` | 20 | $12-$150 | 0 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | — |
| `balanced` | 10 | $10-$150 | 0 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | — |
| `broad` | 5 | $10-$200 | 0 | 6 | 6 | 6 | 0 | 0 | 0 | 0 | 0 | — |

## Profile: strict

- Tight rank movement + price band; safer categories only.
- discovery_run_id: `75a6e62b-6d2b-45a6-b238-8017dcdd1794`, export_batch_id: `aa341b79-eead-4c8b-9c2d-80258620b99a`
- Keepa tokens consumed: 0, tokens left: 9999

Keepa filter losses:
- _(none)_

Validation rejection breakdown:
- `IRRELEVANT_EBAY_COMPARABLES`: 6

## Profile: balanced

- Moderate rank movement; safer categories only.
- discovery_run_id: `e22ab693-f4be-40f6-93c2-7b04f0642d4c`, export_batch_id: `6355e5ca-cb84-4658-83fe-9deb31745a94`
- Keepa tokens consumed: 0, tokens left: 9999

Keepa filter losses:
- _(none)_

Validation rejection breakdown:
- `IRRELEVANT_EBAY_COMPARABLES`: 6

## Profile: broad

- Loose rank movement + wider price band; leans on downstream gates.
- discovery_run_id: `719c40ec-67ae-4014-8ef2-d76074468878`, export_batch_id: `d4f8c55c-f6d7-476a-98b1-c954faf1a208`
- Keepa tokens consumed: 0, tokens left: 9999

Keepa filter losses:
- _(none)_

Validation rejection breakdown:
- `IRRELEVANT_EBAY_COMPARABLES`: 6
