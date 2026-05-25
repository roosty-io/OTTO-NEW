-- 008_business_fit_checks.sql
-- New BusinessFitAgent results.  Sits between compliance and final
-- validation; rejects products learned to be unlistable from manual QA
-- feedback (too cheap, too saturated, too bulky, brand-cautioned).

create table if not exists business_fit_checks (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  asin text,
  amazon_url text,
  amazon_price numeric,
  product_title text,
  brand text,
  business_fit_score numeric,
  price_quality_score numeric,
  saturation_quality_score numeric,
  bulkiness_risk_score numeric,
  brand_caution_score numeric,
  manual_qa_pattern_penalty numeric,
  business_fit_passed boolean,
  business_fit_rejection_reason text,
  reason_codes text[] default '{}',
  notes text[] default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_business_fit_checks_product on business_fit_checks(otto_product_id);
create index if not exists idx_business_fit_checks_passed on business_fit_checks(business_fit_passed);
