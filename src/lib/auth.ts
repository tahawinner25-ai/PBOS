import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { clerkConfigured, supabaseConfigured } from '@/lib/env';
import { createClient, type ServerSupabase } from '@/lib/supabase/server';
import type { CreatorProfile } from '@/lib/types';

/** The signed-in Clerk user. Only the id is carried; anything else is fetched where it is shown. */
export type SessionUser = { id: string };

export type SessionContext =
  | { configured: false }
  | { configured: true; supabase: ServerSupabase; user: SessionUser | null; profile: CreatorProfile | null };

/** Resolved once per request. */
export const getSessionContext = cache(async (): Promise<SessionContext> => {
  if (!clerkConfigured() || !supabaseConfigured()) return { configured: false };
  const { userId } = await auth();
  const supabase = createClient();
  if (!userId) return { configured: true, supabase, user: null, profile: null };

  const { data, error } = await supabase.from('creator_profile').select('*').eq('user_id', userId).maybeSingle();
  if (error) {
    // Do not treat a failed lookup as "no profile": that would send an existing creator back to onboarding.
    console.error('[auth] creator_profile lookup failed:', error.code, error.message, '(check the Clerk Third-Party Auth setting in Supabase and that the migrations ran)');
    throw new Error('Could not load your profile.');
  }
  return { configured: true, supabase, user: { id: userId }, profile: (data as CreatorProfile | null) ?? null };
});

export type CreatorContext = { supabase: ServerSupabase; user: SessionUser; profile: CreatorProfile };

/** For pages: redirects to sign-in or onboarding when needed. Returns null only when the deployment is not configured. */
export async function requireCreator(): Promise<CreatorContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.configured) return null;
  if (!ctx.user) redirect('/login');
  if (!ctx.profile) redirect('/onboarding');
  return { supabase: ctx.supabase, user: ctx.user, profile: ctx.profile };
}

/** For actions and API routes: never redirects. */
export async function getCreatorContext(): Promise<CreatorContext | null> {
  const ctx = await getSessionContext();
  if (!ctx.configured || !ctx.user || !ctx.profile) return null;
  return { supabase: ctx.supabase, user: ctx.user, profile: ctx.profile };
}
