/** Public site URL without a trailing slash. Used for canonical URLs, the sitemap and Open Graph. */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || 'http://localhost:3000';
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  return withProtocol.replace(/\/+$/, '');
}

export function supabaseUrl(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || undefined;
}

/** The public (browser-safe) Supabase key. Accepts the new publishable key or the legacy anon key. */
export function supabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || undefined;
}

export function supabaseConfigured(): boolean {
  return Boolean(supabaseUrl() && supabasePublicKey());
}

/** Server-side only: the secret key is never available in the browser. */
export function clerkConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY);
}

export type SetupStatus = { clerk: boolean; supabase: boolean; missing: string[] };

/** Which required settings are absent. Names only, never values. */
export function setupStatus(): SetupStatus {
  const missing: string[] = [];
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) missing.push('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
  if (!process.env.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
  if (!supabaseUrl()) missing.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabasePublicKey()) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  return { clerk: clerkConfigured(), supabase: supabaseConfigured(), missing };
}

export function contactEmail(): string | null {
  return process.env.NEXT_PUBLIC_CONTACT_EMAIL || null;
}

/** Only allow same-site relative redirects. */
export function safeNextPath(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return next;
}
