# OTTO Keepa Rank-Movement Discovery Report

- **Generated**: 2026-05-28T04:24:23.241Z
- **Command**: `npm run run:keepa-discovery -- --profile=exploratory --limit=6`
- **Profile**: `exploratory` (rank improvement >= 0%, price $5-$300)
- **discovery_run_id**: `9934468e-f6b4-41e4-aa3d-32e37dfb8f70`
- **export_batch_id**: `4db9a8f1-6c05-4959-b375-8572f2c02fbb`

## Funnel

| Stage | Count |
| --- | --- |
| raw Keepa products | 6 |
| ASIN-native candidates | 6 |
| Amazon source valid | 0 |
| demand passed | 0 |
| compliance passed | 0 |
| business fit passed | 0 |
| final validated before dedupe | 0 |
| same-batch duplicates removed | 0 |
| cross-batch repeats removed | 0 |
| exported after all filters | 0 |

## Keepa filter losses (reason codes)

_(none)_

## Keepa API usage

- tokens consumed: 73
- tokens left: 3417

## Amazon source-validation failures (sample)

| ASIN | reason | pageLoaded | price | buyable | stock | gate | restricted |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `B00E4H06TU` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `1096802864` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `1976301300` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `8196916418` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `B0C9S8NV5C` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |
| `8467792515` | AMAZON_PAGE_UNAVAILABLE | false | false | false | unknown | reject | — |

## Top Keepa categories discovered

| Category | rootId | raw | accepted | cat-filtered | price-filtered | rank-filtered |
| --- | --- | --- | --- | --- | --- | --- |
| Home & Kitchen | 1055398 | 1 | 1 | 0 | 0 | 0 |
| Tools & Home Improvement | 228013 | 1 | 1 | 0 | 0 | 0 |
| Patio, Lawn & Garden | 2972638011 | 1 | 1 | 0 | 0 | 0 |
| Office Products | 1064954 | 1 | 1 | 0 | 0 | 0 |
| Arts, Crafts & Sewing | 2617941011 | 1 | 1 | 0 | 0 | 0 |
| Pet Supplies | 2619533011 | 1 | 1 | 0 | 0 | 0 |

## Top exported products

_(none)_

## Rejection breakdown (validation)

| Code | Count |
| --- | --- |
| `AMAZON_PAGE_UNAVAILABLE` | 6 |

- **CSV export path**: `exports/otto-validated-2026-05-28T04-24-22-824Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-28.csv`
