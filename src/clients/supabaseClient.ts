import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/config/env';
import { logger } from '@/utils/logger';

let client: SupabaseClient | null = null;

/**
 * supabase-js v2 instantiates a Realtime client inside createClient(). On
 * Node < 22 there is no native global WebSocket, so Realtime throws:
 *   "Node.js 20 detected without native WebSocket support. Suggested
 *    solution: ... install ws package and provide it via the transport
 *    option."
 *
 * Crucially, @supabase/realtime-js decides whether a native WebSocket exists
 * at *import* time, which happens when this module is first loaded — long
 * before getSupabase() runs. A lazily-assigned `globalThis.WebSocket`
 * polyfill therefore lands too late to be seen. The robust fix (the one that
 * error message itself recommends) is to hand Realtime an explicit
 * `transport`. On Node 22+ a native WebSocket exists and is reused; on Node
 * 20 we resolve one from the `ws` package. We never actually open a Realtime
 * connection — this only stops createClient() from throwing. Returns
 * undefined only if neither a native WebSocket nor `ws` is available.
 */
function resolveWebSocketTransport(): unknown {
  const g = globalThis as unknown as { WebSocket?: unknown };
  if (typeof g.WebSocket !== 'undefined') return g.WebSocket;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ws = require('ws');
    const WS = ws.WebSocket ?? ws;
    // Also expose it globally for any code path that reads the global directly.
    g.WebSocket = WS;
    return WS;
  } catch {
    logger.warn(
      'Native WebSocket missing and `ws` not installed. Supabase Realtime may fail on Node < 22. ' +
        'Install `ws` (npm install ws) or use Node 22+.',
    );
    return undefined;
  }
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  if (!env.supabase.url || !env.supabase.serviceRoleKey) {
    logger.warn('Supabase env vars not set; using in-memory stub. Persistence is disabled.');
    client = createStubClient() as unknown as SupabaseClient;
    return client;
  }
  const transport = resolveWebSocketTransport();
  client = createClient(env.supabase.url, env.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // Provide the WebSocket transport explicitly so Realtime never hits its
    // import-time native-WebSocket check (the source of the Node 20 failure).
    ...(transport ? { realtime: { transport: transport as never } } : {}),
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
