import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { looksLikeAnonKey } from '@/lib/auth-errors';

let warnedWrongKey = false;

/**
 * Service-role client. Bypasses RLS, so it is used only for:
 *  - reading the whitelisted fields of the public media kit,
 *  - inserting contact-form submissions,
 *  - counting profiles for the optional private-instance signup guard (SINGLE_CREATOR_MODE),
 *  - storage cleanup, the Clerk-independent half of account deletion, and platform integrations (scoped by creator id).
 * Never import this from a client component. The key is read from a server-only env var.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (looksLikeAnonKey(key)) {
    // Acting as anon would fail with "permission denied" on every table. Say what is wrong, once, and report "not configured".
    if (!warnedWrongKey) {
      warnedWrongKey = true;
      console.error('[pbos] SUPABASE_SERVICE_ROLE_KEY holds the public anon key, not the service_role key. Copy the service_role (secret) key from Supabase → Project Settings → API Keys.');
    }
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
