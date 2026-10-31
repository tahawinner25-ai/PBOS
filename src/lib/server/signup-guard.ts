import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

export type SignupGate = { open: true } | { open: false; reason: string };

/**
 * Sign-up is open to everyone: PBOS is a multi-creator product and each creator's rows are isolated by
 * row-level security. Set SINGLE_CREATOR_MODE=true to run a private instance instead, where a new profile
 * can be created only while none exists. That mode fails closed: if the check cannot run, the answer is
 * "closed". Also set Clerk's sign-up mode to "Restricted" in the Clerk Dashboard for a private instance.
 */
export async function signupGate(): Promise<SignupGate> {
  if (process.env.SINGLE_CREATOR_MODE !== 'true') return { open: true };

  const admin = createAdminClient();
  if (!admin) {
    return { open: false, reason: 'Private mode needs SUPABASE_SERVICE_ROLE_KEY on the server. Set it, or remove SINGLE_CREATOR_MODE to open sign-up.' };
  }
  const { count, error } = await admin.from('creator_profile').select('id', { count: 'exact', head: true });
  if (error) return { open: false, reason: 'Could not check whether setup is open. Try again in a moment.' };
  if ((count ?? 0) > 0) return { open: false, reason: 'This PBOS instance is private and already has its creator, so new accounts are closed. Sign in with the creator account instead.' };
  return { open: true };
}
