import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!env.supabase.url || !env.supabase.serviceRoleKey) {
    logger.warn('Supabase env vars not set; using in-memory stub. Persistence is disabled.');
    client = createStubClient() as unknown as SupabaseClient;
    return client;
  }
  client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

// Minimal stub so the pipeline can be exercised locally without Supabase.
// Only `from(...).insert(...)` / `.select(...)` semantics are needed today.
function createStubClient(): unknown {
  const store: Record<string, Record<string, unknown>[]> = {};
  return {
    from(table: string) {
      store[table] ??= [];
      const rows = store[table];
      const chain = {
        insert(payload: unknown) {
          const arr = Array.isArray(payload) ? payload : [payload];
          rows.push(...(arr as Record<string, unknown>[]));
          return Promise.resolve({ data: arr, error: null });
        },
        upsert(payload: unknown) {
          const arr = Array.isArray(payload) ? payload : [payload];
          rows.push(...(arr as Record<string, unknown>[]));
          return Promise.resolve({ data: arr, error: null });
        },
        select() {
          return Promise.resolve({ data: rows, error: null });
        },
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        delete() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
      };
      return chain;
    },
    _store: store,
  };
}
