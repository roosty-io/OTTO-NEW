-- =====================================================================
-- OTTO Research Engine V1 - Supabase Postgres schema
-- Run this against your Supabase project once.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------
create table if not exists discovery_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  seed_keywords text[] not null default '{}',
  notes text,
  stats jsonb not null default '{}'::jsonb
);

create table if not exists raw_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid references discovery_runs(id) on delete cascade,
  source text not null,
  source_url text,
  marketplace text,
  keyword text,
  category_hint text,
  product_title_raw text,
  brand_hint text,
  image_url_hint text,
  price_hint numeric,
  discovery_score numeric default 0,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Product opportunities & relationships
-- ---------------------------------------------------------------------
create table if not exists product_opportunities (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text unique not null,
  discovery_run_id uuid references discovery_runs(id) on delete set null,
  primary_discovery_source text,
  secondary_discovery_sources text[] default '{}',
  marketplace_signal_sources text[] default '{}',
  opportunity_type text,
  product_match_type text,
  source_confidence_score numeric,
  core_keyword text,
  related_keywords text[] default '{}',
  ebay_category_hint text,
  amazon_category text,
  created_at timestamptz not null default now()
);

create table if not exists opportunity_relationships (
  id uuid primary key default gen_random_uuid(),
  parent_otto_product_id text not null,
  child_otto_product_id text not null,
  relationship_type text not null,
  similarity_score numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Marketplace & source signals
-- ---------------------------------------------------------------------
create table if not exists marketplace_signals (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  marketplace text not null,
  signal_type text not null,
  signal_value jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

create table if not exists source_signals (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  source text not null,
  signal_type text not null,
  signal_value jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ASIN resolution & Amazon source validation
-- ---------------------------------------------------------------------
create table if not exists asin_candidates (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  raw_candidate_id uuid,
  asin text,
  parent_asin text,
  child_asin text,
  amazon_url text,
  resolver text,
  resolver_method text,
  confidence numeric default 0,
  resolved_title text,
  resolved_brand text,
  resolved_price numeric,
  rating numeric,
  review_count int,
  image_url text,
  product_match_type text,
  title_similarity_score numeric,
  keyword_overlap_score numeric,
  source_confidence_score numeric,
  final_product_match_confidence numeric,
  rejection_reason text,
  accepted boolean not null default false,
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists amazon_source_checks (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  asin text,
  amazon_url text,
  product_title text,
  brand text,
  stock_status text,
  in_stock boolean,
  buyable boolean,
  has_source_price boolean,
  source_price numeric,
  price_currency text,
  is_renewed_or_refurbished boolean,
  is_amazon_basics boolean,
  is_bundle_or_multipack boolean,
  delivery_days int,
  estimated_delivery_days int,
  delivery_text text,
  delivery_parse_confidence text,
  delivery_window_start date,
  delivery_window_end date,
  within_delivery_window boolean,
  seller_text text,
  ships_from_text text,
  sold_by_text text,
  condition_text text,
  rating numeric,
  review_count int,
  coupon_detected boolean,
  coupon_text text,
  restricted_signals text[] default '{}',
  warning_badges text[] default '{}',
  source_validity_score numeric,
  source_valid boolean,
  rejection_reason text,
  passed boolean not null default false,
  reasons text[] default '{}',
  raw_payload jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- eBay demand
-- ---------------------------------------------------------------------
create table if not exists ebay_demand_checks (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  asin text,
  amazon_url text,
  product_title text,
  core_keyword text,
  generated_queries text[] default '{}',
  active_listing_count int,
  relevant_comparable_count int,
  exact_or_similar_match_count int,
  seller_count int,
  seller_concentration_score numeric,
  median_comparable_price numeric,
  avg_comparable_price numeric,
  price_band_min numeric,
  price_band_max numeric,
  low_price numeric,
  high_price numeric,
  listing_quality_gap_score numeric,
  competition_density_score numeric,
  price_viability_score numeric,
  duplicate_ratio numeric,
  demand_score numeric,
  sell_within_30_days_confidence numeric,
  stagnation_risk_score numeric,
  category_velocity_score numeric,
  keyword_demand_score numeric,
  competitor_success_score numeric,
  saturation_score numeric,
  trend_momentum_score numeric,
  demand_type text,
  demand_passed boolean,
  rejection_reason text,
  comparable_samples jsonb default '[]'::jsonb,
  signals jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Compliance
-- ---------------------------------------------------------------------
create table if not exists compliance_checks (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  policy_risk_score numeric,
  vero_risk_score numeric,
  restricted_category_risk_score numeric,
  ip_risk_score numeric,
  edge_case_risk_score numeric,
  fragility_score numeric,
  variation_confusion_score numeric,
  hard_reject boolean not null default false,
  reasons text[] default '{}',
  sub_agent_results jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Cost
-- ---------------------------------------------------------------------
create table if not exists cost_calculations (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  amazon_price numeric not null,
  sales_tax_assumption numeric,
  autods_wallet_fee numeric,
  autods_order_fee numeric,
  return_reserve numeric,
  total_cost_estimate numeric,
  predicted_monthly_profit_per_100_listings numeric,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Final validation
-- ---------------------------------------------------------------------
create table if not exists final_validation_results (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  final_validation_score numeric,
  passed boolean not null default false,
  reasons text[] default '{}',
  rejection_reason text,
  created_at timestamptz not null default now()
);

create table if not exists validated_products (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text unique not null,
  asin text not null,
  parent_asin text,
  child_asin text,
  amazon_url text not null,
  product_title text not null,
  brand text,
  amazon_category text,
  variation_attributes jsonb,
  amazon_price numeric not null,
  coupon_detected boolean default false,
  delivery_days int,
  stock_status text,
  rating numeric,
  review_count int,
  source_confidence_score numeric,
  product_match_type text,
  opportunity_type text,
  marketplace_signal_sources text[] default '{}',
  primary_discovery_source text,
  secondary_discovery_sources text[] default '{}',
  core_keyword text,
  related_keywords text[] default '{}',
  ebay_category_hint text,
  demand_type text,
  sell_within_30_days_confidence numeric,
  stagnation_risk_score numeric,
  demand_score numeric,
  category_velocity_score numeric,
  keyword_demand_score numeric,
  competitor_success_score numeric,
  saturation_score numeric,
  trend_momentum_score numeric,
  policy_risk_score numeric,
  vero_risk_score numeric,
  restricted_category_risk_score numeric,
  ip_risk_score numeric,
  edge_case_risk_score numeric,
  fragility_score numeric,
  variation_confusion_score numeric,
  total_cost_estimate numeric,
  predicted_monthly_profit_per_100_listings numeric,
  final_validation_score numeric,
  validation_status text not null default 'validated',
  validated_at timestamptz not null default now()
);

create table if not exists rejected_products (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  stage text not null,
  reason text not null,
  details jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------
create table if not exists export_batches (
  id uuid primary key default gen_random_uuid(),
  discovery_run_id uuid references discovery_runs(id) on delete set null,
  file_path text not null,
  row_count int not null default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Agent infra
-- ---------------------------------------------------------------------
create table if not exists agent_logs (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  otto_product_id text,
  discovery_run_id uuid,
  level text not null default 'info',
  message text not null,
  data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists agent_votes (
  id uuid primary key default gen_random_uuid(),
  agent_name text not null,
  otto_product_id text not null,
  vote text not null,
  weight numeric not null default 1,
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists agent_messages (
  id uuid primary key default gen_random_uuid(),
  from_agent text not null,
  to_agent text not null,
  otto_product_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Rule tables
-- ---------------------------------------------------------------------
create table if not exists blacklist_brands (
  id uuid primary key default gen_random_uuid(),
  brand text unique not null,
  reason text,
  hard_block boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists blacklist_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text unique not null,
  reason text,
  hard_block boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists restricted_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  reason text,
  hard_block boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists allowed_categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists validation_thresholds (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  value numeric not null,
  description text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Feedback / learning
-- ---------------------------------------------------------------------
create table if not exists product_feedback (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text not null,
  outcome text not null,
  notes text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists source_quality_scores (
  id uuid primary key default gen_random_uuid(),
  source text unique not null,
  precision_score numeric default 0,
  conversion_score numeric default 0,
  sample_size int default 0,
  updated_at timestamptz not null default now()
);

create table if not exists category_performance_scores (
  id uuid primary key default gen_random_uuid(),
  category text unique not null,
  sell_through_rate numeric default 0,
  rejection_rate numeric default 0,
  sample_size int default 0,
  updated_at timestamptz not null default now()
);

create table if not exists weekly_model_adjustments (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  adjustments jsonb not null default '{}'::jsonb,
  applied boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helpful indexes
-- ---------------------------------------------------------------------
create index if not exists idx_raw_candidates_run on raw_candidates(discovery_run_id);
create index if not exists idx_agent_logs_product on agent_logs(otto_product_id);
create index if not exists idx_agent_logs_run on agent_logs(discovery_run_id);
create index if not exists idx_validated_products_validated_at on validated_products(validated_at desc);
create index if not exists idx_rejected_products_product on rejected_products(otto_product_id);
create index if not exists idx_asin_candidates_product on asin_candidates(otto_product_id);
create index if not exists idx_asin_candidates_accepted on asin_candidates(accepted);
create index if not exists idx_amazon_source_checks_product on amazon_source_checks(otto_product_id);
create index if not exists idx_amazon_source_checks_valid on amazon_source_checks(source_valid);
create index if not exists idx_ebay_demand_checks_product on ebay_demand_checks(otto_product_id);
create index if not exists idx_ebay_demand_checks_passed on ebay_demand_checks(demand_passed);
