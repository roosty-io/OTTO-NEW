import { getSupabase } from '@/clients/supabaseClient';
import { logger } from '@/utils/logger';
import {
  ALLOWED_CATEGORIES,
  RESTRICTED_CATEGORIES,
  BLACKLIST_BRANDS,
  BLACKLIST_KEYWORDS,
} from '@/config/categories';
import { THRESHOLDS } from '@/config/thresholds';

const log = logger.child('seed');

export async function seedRules(): Promise<void> {
  const supabase = getSupabase();

  log.info('Seeding allowed_categories', { count: ALLOWED_CATEGORIES.length });
  for (const c of ALLOWED_CATEGORIES) {
    await supabase
      .from('allowed_categories')
      .upsert({ name: c.name, notes: c.notes ?? null }, { onConflict: 'name' } as never);
  }

  log.info('Seeding restricted_categories', { count: RESTRICTED_CATEGORIES.length });
  for (const c of RESTRICTED_CATEGORIES) {
    await supabase
      .from('restricted_categories')
      .upsert({ name: c.name, reason: c.reason, hard_block: c.hardBlock }, { onConflict: 'name' } as never);
  }

  log.info('Seeding blacklist_brands', { count: BLACKLIST_BRANDS.length });
  for (const b of BLACKLIST_BRANDS) {
    await supabase
      .from('blacklist_brands')
      .upsert({ brand: b, reason: 'V1 default seed', hard_block: true }, { onConflict: 'brand' } as never);
  }

  log.info('Seeding blacklist_keywords', { count: BLACKLIST_KEYWORDS.length });
  for (const k of BLACKLIST_KEYWORDS) {
    await supabase
      .from('blacklist_keywords')
      .upsert({ keyword: k, reason: 'V1 default seed', hard_block: true }, { onConflict: 'keyword' } as never);
  }

  const thresholds: { key: string; value: number; description: string }[] = [
    { key: 'DEFAULT_MAX_DELIVERY_DAYS', value: THRESHOLDS.DEFAULT_MAX_DELIVERY_DAYS, description: 'Max acceptable Amazon delivery window in days' },
    { key: 'MAX_POLICY_RISK_SCORE', value: THRESHOLDS.MAX_POLICY_RISK_SCORE, description: 'Upper bound on combined compliance risk' },
    { key: 'MIN_SELL_WITHIN_30_DAYS_CONFIDENCE', value: THRESHOLDS.MIN_SELL_WITHIN_30_DAYS_CONFIDENCE, description: 'Lower bound on demand confidence' },
    { key: 'MAX_STAGNATION_RISK_SCORE', value: THRESHOLDS.MAX_STAGNATION_RISK_SCORE, description: 'Upper bound on stagnation risk' },
    { key: 'MIN_FINAL_VALIDATION_SCORE', value: THRESHOLDS.MIN_FINAL_VALIDATION_SCORE, description: 'Lower bound on overall validation score' },
    { key: 'SALES_TAX_ASSUMPTION_PCT', value: THRESHOLDS.SALES_TAX_ASSUMPTION_PCT, description: 'Assumed sales tax %' },
    { key: 'AUTODS_WALLET_FEE_PCT', value: THRESHOLDS.AUTODS_WALLET_FEE_PCT, description: 'AutoDS wallet fee %' },
    { key: 'AUTODS_ORDER_FEE_FLAT', value: THRESHOLDS.AUTODS_ORDER_FEE_FLAT, description: 'AutoDS per-order flat fee' },
    { key: 'RETURN_RESERVE_PCT', value: THRESHOLDS.RETURN_RESERVE_PCT, description: 'Return reserve %' },
  ];

  log.info('Seeding validation_thresholds', { count: thresholds.length });
  for (const t of thresholds) {
    await supabase
      .from('validation_thresholds')
      .upsert({ key: t.key, value: t.value, description: t.description }, { onConflict: 'key' } as never);
  }

  log.info('Seed complete');
}
