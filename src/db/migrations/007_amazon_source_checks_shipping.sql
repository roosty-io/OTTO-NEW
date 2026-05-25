-- 007_amazon_source_checks_shipping.sql
-- New Prime / FBA / shipping-gate columns on amazon_source_checks.
-- Safe to re-run.

alter table amazon_source_checks add column if not exists raw_delivery_text text;
alter table amazon_source_checks add column if not exists fastest_delivery_text text;
alter table amazon_source_checks add column if not exists delivery_context text;
alter table amazon_source_checks add column if not exists address_zip_used text;
alter table amazon_source_checks add column if not exists delivery_parse_method text;
alter table amazon_source_checks add column if not exists prime_signal_detected boolean;
alter table amazon_source_checks add column if not exists prime_signal_source text;
alter table amazon_source_checks add column if not exists fba_signal_detected boolean;
alter table amazon_source_checks add column if not exists ships_from_amazon boolean;
alter table amazon_source_checks add column if not exists sold_by_amazon boolean;
alter table amazon_source_checks add column if not exists fulfilled_by_amazon boolean;
alter table amazon_source_checks add column if not exists shipping_confidence text;
alter table amazon_source_checks add column if not exists shipping_review_required boolean;
alter table amazon_source_checks add column if not exists shipping_gate_result text;

create index if not exists idx_amazon_source_checks_shipping on amazon_source_checks(shipping_gate_result);
create index if not exists idx_amazon_source_checks_prime on amazon_source_checks(prime_signal_detected);
