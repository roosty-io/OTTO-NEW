-- 002_amazon_source_checks_v2.sql
-- Extend amazon_source_checks with the fields produced by the real
-- Playwright-backed AmazonSourceValidationAgent.  Safe to re-run.

alter table amazon_source_checks add column if not exists amazon_url text;
alter table amazon_source_checks add column if not exists product_title text;
alter table amazon_source_checks add column if not exists brand text;
alter table amazon_source_checks add column if not exists stock_status text;
alter table amazon_source_checks add column if not exists buyable boolean;
alter table amazon_source_checks add column if not exists source_price numeric;
alter table amazon_source_checks add column if not exists price_currency text;
alter table amazon_source_checks add column if not exists delivery_text text;
alter table amazon_source_checks add column if not exists estimated_delivery_days int;
alter table amazon_source_checks add column if not exists delivery_parse_confidence text;
alter table amazon_source_checks add column if not exists delivery_window_start date;
alter table amazon_source_checks add column if not exists delivery_window_end date;
alter table amazon_source_checks add column if not exists seller_text text;
alter table amazon_source_checks add column if not exists ships_from_text text;
alter table amazon_source_checks add column if not exists sold_by_text text;
alter table amazon_source_checks add column if not exists condition_text text;
alter table amazon_source_checks add column if not exists rating numeric;
alter table amazon_source_checks add column if not exists review_count int;
alter table amazon_source_checks add column if not exists coupon_detected boolean;
alter table amazon_source_checks add column if not exists coupon_text text;
alter table amazon_source_checks add column if not exists restricted_signals text[];
alter table amazon_source_checks add column if not exists warning_badges text[];
alter table amazon_source_checks add column if not exists source_validity_score numeric;
alter table amazon_source_checks add column if not exists source_valid boolean;
alter table amazon_source_checks add column if not exists rejection_reason text;

create index if not exists idx_amazon_source_checks_product on amazon_source_checks(otto_product_id);
create index if not exists idx_amazon_source_checks_valid on amazon_source_checks(source_valid);
