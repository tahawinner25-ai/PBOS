// Security headers for every response. Plain ESM so next.config.mjs can import it, and so tests can too.
// Types live in security-headers.d.mts.

/**
 * The Clerk Frontend API host is encoded in the publishable key: pk_test_<base64 of "host$">.
 * Returns null when the key is missing or does not decode to a plausible hostname.
 * @param {string | undefined} publishableKey
 * @returns {string | null}
 */
export function clerkFrontendHost(publishableKey) {
  if (!publishableKey) return null;
  const encoded = publishableKey.split('_').slice(2).join('_');
  if (!encoded) return null;
  try {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const host = decoded.endsWith('$') ? decoded.slice(0, -1) : '';
    return /^[a-z0-9.-]+$/i.test(host) && host.includes('.') ? host : null;
  } catch {
    return null;
  }
}

/** @param {string | undefined} raw */
function originOf(raw) {
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).origin;
  } catch {
    return null;
  }
}

/**
 * Content-Security-Policy.
 *
 * script-src keeps 'unsafe-inline' because the Next.js App Router injects inline bootstrap scripts and a
 * per-request nonce would force every page, including the public landing page, to render dynamically.
 * That is the trade-off Clerk's own guidance makes too. Everything else is locked to named origins:
 * Clerk (sign-in), Cloudflare Turnstile (contact form), optional Plausible and the Supabase project.
 *
 * @param {{ production: boolean, clerkPublishableKey?: string, supabaseUrl?: string, plausibleDomain?: string }} options
 * @returns {string}
 */
export function buildCsp({ production, clerkPublishableKey, supabaseUrl, plausibleDomain }) {
  const clerkHost = clerkFrontendHost(clerkPublishableKey);
  const clerk = clerkHost ? [`https://${clerkHost}`] : [];
  const turnstile = 'https://challenges.cloudflare.com';
  const protect = 'https://*.protect.clerk.com';
  const supabase = originOf(supabaseUrl);
  const plausible = plausibleDomain ? ['https://plausible.io'] : [];

  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(production ? [] : ["'unsafe-eval'"]), ...clerk, turnstile, protect, ...plausible],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https://img.clerk.com', ...(supabase ? [supabase] : [])],
    'font-src': ["'self'", 'data:'],
    // connect-src includes the Supabase origin: the browser uploads media straight to private storage through a one-time signed URL.
    'connect-src': ["'self'", ...clerk, turnstile, `${protect}:*`, ...plausible, ...(supabase ? [supabase] : []), ...(production ? [] : ['ws:', 'wss:'])],
    'media-src': ["'self'", 'blob:', ...(supabase ? [supabase] : [])],
    'frame-src': ["'self'", turnstile, protect],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };

  const parts = Object.entries(directives).map(([name, values]) => `${name} ${values.join(' ')}`);
  if (production) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * @param {{ production: boolean, reportOnly?: boolean, clerkPublishableKey?: string, supabaseUrl?: string, plausibleDomain?: string }} options
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(options) {
  const headers = [
    { key: options.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', value: buildCsp(options) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
  if (options.production) headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000' });
  return headers;
}
