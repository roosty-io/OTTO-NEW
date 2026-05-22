-- 003_ebay_demand_checks_v2.sql
-- Extend ebay_demand_checks with the fields produced by the V1 eBay
-- 30-Day Sell Probability Engine.  Safe to re-run.

alter table ebay_demand_checks add column if not exists asin text;
alter table ebay_demand_checks add column if not exists amazon_url text;
alter table ebay_demand_checks add column if not exists product_title text;
alter table ebay_demand_checks add column if not exists core_keyword text;
alter table ebay_demand_checks add column if not exists generated_queries text[] default '{}';
alter table ebay_demand_checks add column if not exists active_listing_count int;
alter table ebay_demand_checks add column if not exists relevant_comparable_count int;
alter table ebay_demand_checks add column if not exists exact_or_similar_match_count int;
alter table ebay_demand_checks add column if not exists seller_count int;
alter table ebay_demand_checks add column if not exists seller_concentration_score numeric;
alter table ebay_demand_checks add column if not exists median_comparable_price numeric;
alter table ebay_demand_checks add column if not exists avg_comparable_price numeric;
alter table ebay_demand_checks add column if not exists price_band_min numeric;
alter table ebay_demand_checks add column if not exists price_band_max numeric;
alter table ebay_demand_checks add column if not exists low_price numeric;
alter table ebay_demand_checks add column if not exists high_price numeric;
alter table ebay_demand_checks add column if not exists listing_quality_gap_score numeric;
alter table ebay_demand_checks add column if not exists competition_density_score numeric;
alter table ebay_demand_checks add column if not exists price_viability_score numeric;
alter table ebay_demand_checks add column if not exists duplicate_ratio numeric;
alter table ebay_demand_checks add column if not exists demand_passed boolean;
alter table ebay_demand_checks add column if not exists rejection_reason text;
alter table ebay_demand_checks add column if not exists comparable_samples jsonb default '[]'::jsonb;

create index if not exists idx_ebay_demand_checks_product on ebay_demand_checks(otto_product_id);
create index if not exists idx_ebay_demand_checks_passed on ebay_demand_checks(demand_passed);
