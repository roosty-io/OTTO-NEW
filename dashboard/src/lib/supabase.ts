import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL ?? '';
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const MOCK = String(import.meta.env.VITE_MOCK_DASHBOARD ?? '').toLowerCase() === 'true';
export const SUPABASE_CONFIGURED = Boolean(URL && KEY);

let _client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (_client) return _client;
  if (!SUPABASE_CONFIGURED) {
    throw new Error(
      'Supabase env vars not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in dashboard/.env, ' +
        'or set VITE_MOCK_DASHBOARD=true to preview with canned data.',
    );
  }
  _client = createClient(URL, KEY, { auth: { persistSession: false } });
  return _client;
}
