-- 001_asin_candidates_v2.sql
-- Extend asin_candidates with the fields produced by the real Playwright
-- BasicAmazonAsinResolverAgent.  Safe to re-run on an existing schema.

alter table asin_candidates add column if not exists raw_candidate_id uuid;
alter table asin_candidates add column if not exists parent_asin text;
alter table asin_candidates add column if not exists child_asin text;
alter table asin_candidates add column if not exists rating numeric;
alter table asin_candidates add column if not exists review_count int;
alter table asin_candidates add column if not exists image_url text;
alter table asin_candidates add column if not exists product_match_type text;
alter table asin_candidates add column if not exists title_similarity_score numeric;
alter table asin_candidates add column if not exists keyword_overlap_score numeric;
alter table asin_candidates add column if not exists source_confidence_score numeric;
alter table asin_candidates add column if not exists final_product_match_confidence numeric;
alter table asin_candidates add column if not exists resolver_method text;
alter table asin_candidates add column if not exists rejection_reason text;
alter table asin_candidates add column if not exists accepted boolean not null default false;

create index if not exists idx_asin_candidates_product on asin_candidates(otto_product_id);
create index if not exists idx_asin_candidates_accepted on asin_candidates(accepted);
