-- 005_deduped_products.sql
-- Track ASIN-level deduplication decisions made at CSV export time so
-- analytics can see which rows were collapsed and why.

create table if not exists deduped_products (
  id uuid primary key default gen_random_uuid(),
  duplicate_group_id uuid not null,
  asin text not null,
  kept_otto_product_id text not null,
  removed_otto_product_id text not null,
  removed_reason text not null default 'duplicate_asin',
  kept_final_validation_score numeric,
  removed_final_validation_score numeric,
  kept_sell_within_30_days_confidence numeric,
  removed_sell_within_30_days_confidence numeric,
  kept_policy_risk_score numeric,
  removed_policy_risk_score numeric,
  kept_stagnation_risk_score numeric,
  removed_stagnation_risk_score numeric,
  export_batch_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_deduped_products_asin on deduped_products(asin);
create index if not exists idx_deduped_products_batch on deduped_products(export_batch_id);

-- export_batches gets pre/post-dedupe counts for at-a-glance review.
alter table export_batches add column if not exists final_validated_before_dedupe int default 0;
alter table export_batches add column if not exists duplicate_asins_removed int default 0;
alter table export_batches add column if not exists final_exported_after_dedupe int default 0;
