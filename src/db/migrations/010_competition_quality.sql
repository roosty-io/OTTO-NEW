-- 010_competition_quality.sql
-- V1.2 competition gate columns on business_fit_checks.

alter table business_fit_checks add column if not exists competition_quality_score numeric;
alter table business_fit_checks add column if not exists seller_competition_score numeric;
alter table business_fit_checks add column if not exists exact_match_saturation_score numeric;
alter table business_fit_checks add column if not exists duplicate_listing_score numeric;
alter table business_fit_checks add column if not exists price_compression_score numeric;
alter table business_fit_checks add column if not exists same_source_likelihood_score numeric;
alter table business_fit_checks add column if not exists is_generic_commodity boolean;
alter table business_fit_checks add column if not exists competition_gate_result text;
alter table business_fit_checks add column if not exists competition_rejection_reason text;
alter table business_fit_checks add column if not exists seller_count int;
alter table business_fit_checks add column if not exists exact_or_similar_match_count int;
alter table business_fit_checks add column if not exists duplicate_ratio numeric;
