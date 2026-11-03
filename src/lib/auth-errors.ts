/**
 * Telling "Supabase does not trust the Clerk sign-in yet" apart from an ordinary database failure.
 *
 * Supabase answers PGRST301 (or "No suitable key or wrong key type") when it cannot verify the token Clerk issued,
 * which means Third-Party Auth for Clerk has not been switched on in Supabase, or Clerk's Supabase integration has not
 * been activated. Every signed-in page would otherwise fail with a generic "could not load" message and no way to know why.
 */

export class AuthSetupError extends Error {
  constructor() {
    super('Supabase is not set up to accept Clerk sign-ins yet.');
    this.name = 'AuthSetupError';
  }
}

export function isTokenRejected(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST301' || error.code === 'PGRST302') return true;
  return typeof error.message === 'string' && /no suitable key|wrong key type|JWSError|invalid jwt/i.test(error.message);
}

/** The `role` claim of a Supabase JWT key, or null for anything that is not a readable JWT (for example an `sb_secret_` key). */
export function keyRole(key: string): string | null {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/** True when the value saved as the service-role key is really the public anon key (a common paste mistake). */
export function looksLikeAnonKey(key: string): boolean {
  const role = keyRole(key);
  return role === 'anon' || role === 'authenticated';
}

/** The Clerk domain inside a publishable key (public by design), for example `example-app-12.clerk.accounts.dev`. */
export function clerkDomainOf(publishableKey: string | undefined): string | null {
  const m = /^pk_(?:test|live)_(.+)$/.exec(publishableKey ?? '');
  if (!m) return null;
  try {
    const host = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8').replace(/\$$/, '');
    return /^[a-z0-9.-]+$/i.test(host) ? host : null;
  } catch {
    return null;
  }
}
