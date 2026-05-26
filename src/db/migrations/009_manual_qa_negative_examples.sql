-- 009_manual_qa_negative_examples.sql
-- Pattern reference for ASINs the operator manually rejected.  NOT a hard
-- ASIN blacklist - the scorer never auto-rejects on a row in this table.
-- Used by future analysis / tuning passes to spot recurring patterns.
-- Also: add the new differentiation columns to business_fit_checks.

create table if not exists manual_qa_negative_examples (
  id uuid primary key default gen_random_uuid(),
  asin text not null,
  product_title text,
  brand text,
  reason text,
  batch_label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_qa_negative_examples_asin on manual_qa_negative_examples(asin);

alter table business_fit_checks add column if not exists differentiation_score numeric;
alter table business_fit_checks add column if not exists similar_listing_penalty numeric;
alter table business_fit_checks add column if not exists duplicate_market_penalty numeric;
