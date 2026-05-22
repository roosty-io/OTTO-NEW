-- 004_compliance_checks_v2.sql
-- Extend compliance_checks for the hardened ComplianceRiskCouncil.

alter table compliance_checks add column if not exists asin text;
alter table compliance_checks add column if not exists amazon_url text;
alter table compliance_checks add column if not exists product_title text;
alter table compliance_checks add column if not exists brand text;
alter table compliance_checks add column if not exists category_text text;
alter table compliance_checks add column if not exists hard_block boolean default false;
alter table compliance_checks add column if not exists manual_review boolean default false;
alter table compliance_checks add column if not exists compliance_passed boolean default false;
alter table compliance_checks add column if not exists matched_brands text[] default '{}';
alter table compliance_checks add column if not exists matched_keywords text[] default '{}';
alter table compliance_checks add column if not exists matched_categories text[] default '{}';
alter table compliance_checks add column if not exists triggered_agents text[] default '{}';
alter table compliance_checks add column if not exists reason_codes text[] default '{}';
alter table compliance_checks add column if not exists notes text[] default '{}';

create index if not exists idx_compliance_checks_product on compliance_checks(otto_product_id);
create index if not exists idx_compliance_checks_passed on compliance_checks(compliance_passed);
create index if not exists idx_compliance_checks_block on compliance_checks(hard_block);
