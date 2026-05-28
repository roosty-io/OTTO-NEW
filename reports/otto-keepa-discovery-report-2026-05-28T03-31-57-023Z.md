# OTTO Keepa Rank-Movement Discovery Report

- **Generated**: 2026-05-28T03:32:08.171Z
- **Command**: `npm run run:keepa-discovery -- --limit=12`
- **discovery_run_id**: `5e3e486f-3376-4799-9054-15583f348d2e`
- **export_batch_id**: `33965afa-4a13-4350-9e81-485d475ee3e6`

## Funnel

| Stage | Count |
| --- | --- |
| raw Keepa candidates | 12 |
| ASIN-native candidates | 1 |
| ASIN resolved/bypassed | 1 |
| Amazon source valid | 0 |
| demand passed | 0 |
| compliance passed | 0 |
| business fit passed | 0 |
| final validated before dedupe | 0 |
| same-batch duplicates removed | 0 |
| cross-batch repeats removed | 0 |
| exported after all filters | 0 |

## Cross-batch repeat filtering

- repeat policy: `exclude_recent`
- repeat lookback days: 30
- cross-batch repeats removed: 0

## Keepa API usage

- tokens consumed: 80
- tokens left: 3520

## Top Keepa categories discovered

| Category | rootId | raw | accepted | cat-filtered | price-filtered | rank-filtered |
| --- | --- | --- | --- | --- | --- | --- |
| Home & Kitchen | 1055398 | 2 | 1 | 0 | 0 | 1 |
| Tools & Home Improvement | 228013 | 2 | 0 | 0 | 0 | 2 |
| Patio, Lawn & Garden | 2972638011 | 2 | 0 | 0 | 0 | 2 |
| Office Products | 1064954 | 2 | 0 | 0 | 0 | 2 |
| Arts, Crafts & Sewing | 2617941011 | 2 | 0 | 0 | 0 | 2 |
| Pet Supplies | 2619533011 | 2 | 0 | 0 | 0 | 2 |

## Top exported products

_(none)_

## Rejection breakdown

| Code | Count |
| --- | --- |
| `AMAZON_PAGE_UNAVAILABLE` | 1 |

- **CSV export path**: `exports/otto-validated-2026-05-28T03-32-07-832Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-28.csv`
