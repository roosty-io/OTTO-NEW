# OTTO Keepa Rank-Movement Discovery Report

- **Generated**: 2026-05-28T03:27:20.002Z
- **Command**: `npm run run:keepa-discovery -- --limit=10`
- **discovery_run_id**: `3c9c67d6-f305-4f03-9338-aec35fa1b362`
- **export_batch_id**: `9f231189-1acb-46d7-94aa-6d4054dfef13`

## Funnel

| Stage | Count |
| --- | --- |
| raw Keepa candidates | 6 |
| ASIN-native candidates | 6 |
| ASIN resolved/bypassed | 6 |
| Amazon source valid | 6 |
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

- tokens consumed: 0
- tokens left: 9999

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

## Rejection breakdown

| Code | Count |
| --- | --- |
| `IRRELEVANT_EBAY_COMPARABLES` | 6 |

- **CSV export path**: `exports/otto-validated-2026-05-28T03-27-19-588Z.csv`
- **manual QA CSV path**: `exports/otto_manual_qa_review_2026-05-28.csv`
