-- 011_resolver_diagnostics.sql
-- V1.3 Amazon resolver reliability columns on asin_candidates.
-- Captures per-candidate retry / malformed-page / block / timeout counts
-- so analysis can spot resolver instability separately from candidate
-- quality issues.

alter table asin_candidates add column if not exists amazon_query_attempts_count int;
alter table asin_candidates add column if not exists malformed_page_count int;
alter table asin_candidates add column if not exists captcha_block_count int;
alter table asin_candidates add column if not exists timeout_count int;
alter table asin_candidates add column if not exists successful_query text;
alter table asin_candidates add column if not exists failed_queries_json jsonb default '[]'::jsonb;
alter table asin_candidates add column if not exists resolver_retry_count int;
alter table asin_candidates add column if not exists final_resolver_error_code text;

create index if not exists idx_asin_candidates_resolver_error on asin_candidates(final_resolver_error_code);
