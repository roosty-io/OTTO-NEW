import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

let client: SupabaseClient | null = null;

/**
 * supabase-js v2 instantiates a Realtime client inside createClient(), which
 * throws on Node < 22 ("Node.js 20 detected without native WebSocket
 * support") unless a global WebSocket exists. We never use Realtime, but the
 * eager check still fires. Node 22+ has a native WebSocket; on older Node we
 * polyfill it from the `ws` package. Best-effort: if `ws` is unavailable we
 * continue (Node 22+ won't need it).
 */
function ensureWebSocket(): void {
  const g = globalThis as unknown as { WebSocket?: unknown };
  if (typeof g.WebSocket !== 'undefined') return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws');
    g.WebSocket = ws.WebSocket ?? ws;
  } catch {
    logger.warn(
      'Native WebSocket missing and `ws` not installed. Supabase may fail on Node < 22. ' +
        'Install `ws` (npm install ws) or use Node 22+.',
    );
  }
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!env.supabase.url || !env.supabase.serviceRoleKey) {
    logger.warn('Supabase env vars not set; using in-memory stub. Persistence is disabled.');
    client = createStubClient() as unknown as SupabaseClient;
    return client;
  }
  ensureWebSocket();
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
