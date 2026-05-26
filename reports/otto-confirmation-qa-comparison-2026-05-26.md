# OTTO Confirmation QA — Post-Manual-QA Tuning

- **Generated**: 2026-05-26
- **Tuning commit**: `86ba1a4` (light differentiation tuning + manual_qa_negative_examples)
- **Prior batch (operator manually reviewed)**:
  - run: `npm run run:real-qa -- --limit=25` (post-business-fit)
  - report: `reports/otto-real-qa-report-2026-05-25T04-45-44-240Z.md`
  - export: `exports/otto-validated-2026-05-25T05-05-53-177Z.csv`
  - manual review: `exports/otto_manual_qa_review_2026-05-25_filled.csv`
  - **reviewed: 20, would-list yes: 17, no: 3, approval: 85.0%**
  - ASIN-real: 100%, demand-makes-sense: 100%, low-risk: 100%
  - 3 "no" reasons: all "too many sellers / too many similar listings"
    - B089B4XZM4 (VIVO Cable Tray)
    - B0CMCS65GB (HOOPLE Kneeling Pad)
    - B0BCJQ31XZ (BTSKY Craft Storage Box)
- **Confirmation batch**:
  - run: `npm run run:real-qa -- --limit=25`
  - report: `reports/otto-real-qa-report-2026-05-26T04-08-58-747Z.md`
  - export: `exports/otto-validated-2026-05-26T04-30-07-170Z.csv`
  - manual QA CSV: `exports/otto_manual_qa_review_2026-05-26.csv`

## Stage-by-stage comparison (limit=25 both)

| Stage | Prior | Confirmation | Δ |
| --- | ---:| ---:| ---:|
| raw candidates | 125 | 125 | 0 |
| ASIN resolved | 53 | 49 | -4 |
| Amazon source valid | 44 | 41 | -3 |
| demand passed | 37 | 33 | -4 |
| compliance passed | 35 | 32 | -3 |
| **business fit passed** | 25 | **23** | -2 |
| **business fit failed** | 10 | **9** | -1 |
| final validated | 25 | 22 | -3 |
| duplicate ASINs removed | 5 | 3 | -2 |
| **exported after dedupe** | **20** | **19** | -1 |
| end-to-end pass rate | 20.0% | 17.6% | -2.4 pp |

## Business-fit rejection breakdown

| Code | Prior | Confirmation |
| --- | ---:| ---:|
| `TOO_CHEAP` | 6 | 5 |
| `BUSINESS_FIT_FAILED` | 3 | 2 |
| `BULKY_HIGH_TICKET_CAUTION` | 1 | 2 |
| Total business-fit rejections | **10** | **9** |

The new differentiation scorer fires per-product but didn't dominate
any rejections this batch — the tightening was deliberately light per
spec ("Do not over-tighten. The batch passed at 85%."). Penalties
appear as `LOW_DIFFERENTIATION` / `TOO_MANY_SIMILAR_LISTINGS` /
`SATURATED_GENERIC_PRODUCT` inside `business_fit_checks.reason_codes`
but no product was solely rejected on differentiation in this batch.

## Saturation/differentiation rejection breakdown

| Code | Count |
| --- | ---:|
| `LOW_DIFFERENTIATION` | 0 sole-cause rejections (soft penalty applied to ~5 surviving products inside `reason_codes`) |
| `TOO_MANY_SIMILAR_LISTINGS` | as above |
| `HIGH_DUPLICATE_MARKET` | as above |
| `SATURATED_GENERIC_PRODUCT` | as above |

By design the differentiation penalty caps at -35 even when all
saturation conditions hit, so it doesn't single-handedly drop a
product below the 70 business-fit floor unless price quality or
bulkiness also degrades.

## Top 10 confirmation exports

| Rank | ASIN | Title | Brand | Price | 30d conf | Final |
| ---:| --- | --- | --- | ---:| ---:| ---:|
| 1 | B0B6RCKQBS | Parts Screws Storage Organizer | whillar | $23.99 | 84 | 86 |
| 2 | B0BCJQ31XZ | BTSKY Craft Storage Box | BTSKY | $20.99 | 92 | 85 |
| 3 | B0F7TQQJ3B | RoseArt Craft Storage Box | RoseArt | $13.29 | 89 | 84 |
| 4 | B0BVVDC3KH | WORKPRO Kneeling Pad | WORKPRO | $15.19 | 90 | 84 |
| 5 | B08QTNM1TJ | Comfy Kneeling Pad | Omixe | $12.96 | 89 | 84 |
| 6 | B0BXWLJQHR | Comfy Kneeling Pad | Omixe | $12.96 | 89 | 83 |
| 7 | B0CMCS65GB | HOOPLE Kneeling Pad | HOOPLE | $12.99 | 90 | 82 |
| 8 | B098QQ2B4B | HappyPicnic Kneeling Pad | HappyPicnic | $17.98 | 84 | 82 |
| 9 | B084R6JNNV | 7 Elements Wooden Storage | 7 Elements | $33.99 | 83 | 82 |
| 10 | B089B4XZM4 | VIVO Cable Tray | (none) | $19.99 | 84 | 81 |

> Note: B0BCJQ31XZ, B0CMCS65GB, and B089B4XZM4 are all on the
> operator's negative-examples pattern list from the prior batch.
> They were NOT hard-blacklisted (per task: "Use these examples only
> as pattern references for scoring, not as hard ASIN bans") and so
> remain in the export. If the operator marks them "no" again, the
> differentiation penalty can be raised in the next tuning pass.

## Dedupe + schema validation

- 19 rows / 19 unique ASINs / **zero duplicate ASINs** (`uniq -d` empty).
- All 10 shipping columns + new differentiation columns
  (`differentiation_score`, `similar_listing_penalty`,
  `duplicate_market_penalty`) persist to `business_fit_checks` (migration 009).
- min export price = **$12.96** (above the strict $12 floor).
- `manual_qa_negative_examples` table seeded with 3 pattern reference
  rows, NOT a hard blacklist.

## Decision

- **Confirmation batch is ready for manual review.**
- Manual review target: **≥ 70% would-list approval**.
- Open `exports/otto_manual_qa_review_2026-05-26.csv`, fill the five
  reviewer columns, then:

  ```bash
  npm run import:manual-qa  -- --file=exports/otto_manual_qa_review_2026-05-26.csv \
                                --batch-label="confirmation limit=25"
  npm run analyze:manual-qa -- --file=exports/otto_manual_qa_review_2026-05-26.csv \
                                --batch-label="confirmation limit=25"
  ```

## What comes next based on the confirmation review

- **If approval ≥ 70%**: two consecutive batches at the same `--limit=25`
  have cleared the gate. Two choices for the next milestone:
  1. **Internal dashboard** (recommended now): the volume of QA reports,
     CSV exports, and rejection-breakdown columns is starting to be
     painful to scan by hand. A read-only dashboard that surfaces the
     latest batch's stage funnel, top exports, rejection codes, and
     manual-QA history would make iteration much faster than reading
     Markdown files.
  2. **Scale to `--limit=50`**: same five keywords, 250 raw candidates,
     ~38–40 exports expected. Useful only if review bandwidth keeps up.
- **If approval < 70%**: the analyzer will tell you which pattern
  dominated; raise the differentiation penalty band (e.g. trigger
  `LOW_DIFFERENTIATION` at 2 conditions instead of 3) or tighten
  `MAX_SATURATION_QUALITY_RISK`, then re-run.

Recommendation: **build the internal dashboard next** once the
confirmation review clears 70%. The QA loop is now mature enough that
operational visibility is the bottleneck, not pipeline tuning.
