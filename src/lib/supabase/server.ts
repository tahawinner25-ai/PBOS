import 'server-only';
import { auth } from '@clerk/nextjs/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { supabasePublicKey, supabaseUrl } from '@/lib/env';

/**
 * Supabase client acting as the signed-in creator.
 *
 * Clerk is the identity provider. Each request carries the creator's Clerk session token; Supabase
 * verifies it through Third-Party Auth, and row-level security reads the user id from its `sub` claim
 * (`auth.jwt() ->> 'sub'`). A signed-out request carries no token, so it runs as `anon`, which has no
 * table privileges at all.
 */
export function createClient() {
  return createSupabaseClient(supabaseUrl()!, supabasePublicKey()!, {
    async accessToken() {
      return (await auth()).getToken();
    },
  });
}

export type ServerSupabase = ReturnType<typeof createClient>;
