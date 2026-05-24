# OTTO Manual QA Summary — First Real QA Batch

- **Generated**: 2026-05-24
- **Batch label**: first real QA batch
- **Source files**:
  - export: `exports/otto-validated-2026-05-24T17-47-06-700Z.csv`
  - manual QA review sheet: `exports/otto_manual_qa_review_2026-05-24.csv`
- **Run report**: `reports/otto-real-qa-report-2026-05-24T17-38-35-839Z.md`

## Counts

| Metric | Value |
| --- | --- |
| products in CSV export | 13 |
| products reviewed | 13 |
| would-list yes | 10 |
| would-list approval rate | 76.9% |

> Per-product reviewer answers (the `would_list_yes_no`, `asin_real_yes_no`,
> `demand_makes_sense_yes_no`, `low_risk_yes_no`, `notes` columns) have **not** been
> filled into the CSV yet, so they have not been recorded in the
> `manual_qa_reviews` table.  This document captures only the batch-level
> verdict that the operator confirmed at the time of review.  When the CSV is
> filled in, run:
>
> ```
> npm run import:manual-qa -- \
>   --file=exports/otto_manual_qa_review_2026-05-24.csv \
>   --batch-label="first real QA batch"
> ```

## Verdict

**PASS** — would-list approval rate **76.9%** (10 of 13 reviewed products) clears
the >= 70% target.  Safe to proceed with a larger second QA batch once
ASIN-level deduplication is in place.

## Notes from the operator

- Approximately **10 of 13** products would be listed.
- One known data-quality issue surfaced: ASIN `B0F1YL7C2T` appeared twice in
  the export because two distinct eBay candidates resolved to the same Amazon
  product.  ASIN-level deduplication has now been implemented in
  `CsvExportAgent.run()` (priority order: highest `final_validation_score`,
  highest `sell_within_30_days_confidence`, lowest `policy_risk_score`,
  lowest `stagnation_risk_score`, most recent `validated_at`) and removed
  rows are logged to `deduped_products` plus an `EXPORT_DEDUPED_ASIN`
  `agent_logs` entry.
