-- 006_manual_qa_reviews.sql
-- Human review answers from the manual QA CSV.

create table if not exists manual_qa_reviews (
  id uuid primary key default gen_random_uuid(),
  otto_product_id text,
  asin text,
  amazon_url text,
  product_title text,
  brand text,
  amazon_price numeric,
  delivery_days int,
  sell_within_30_days_confidence numeric,
  stagnation_risk_score numeric,
  policy_risk_score numeric,
  final_validation_score numeric,
  would_list_yes_no text,
  asin_real_yes_no text,
  demand_makes_sense_yes_no text,
  low_risk_yes_no text,
  notes text,
  reviewed_at timestamptz,
  source_file text,
  batch_label text,
  created_at timestamptz not null default now()
);

create index if not exists idx_manual_qa_reviews_asin on manual_qa_reviews(asin);
create index if not exists idx_manual_qa_reviews_batch on manual_qa_reviews(batch_label);
create index if not exists idx_manual_qa_reviews_would_list on manual_qa_reviews(would_list_yes_no);
