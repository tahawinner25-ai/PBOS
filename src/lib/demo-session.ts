/**
 * The 10-minute demo clock.
 *
 * A visitor who starts the demo gets a cookie holding { sid, startedAt, expiresAt }, signed with
 * DEMO_SESSION_SECRET. The server decides whether the demo is still open; the browser's timer is only a
 * display. The check runs in three places that all call the same function: the edge middleware (every request
 * to /demo/workspace and /api/demo/*), each demo page, and each demo API handler. Because those include the
 * edge runtime, this module uses Web Crypto only (no node:crypto), so the signer and the verifier are the same
 * code on both runtimes and cannot disagree.
 *
 * A signed cookie cannot be extended or edited, but it can be deleted. A visitor who clears cookies can start
 * a fresh demo; the demo holds only invented sample data, so nothing is at stake, and starts are also rate
 * limited per IP address. This is a trial gate, not a security boundary.
 */

export const DEMO_MS = 10 * 60 * 1000;
export const DEMO_COOKIE = 'pbos_demo';
export const DEMO_USED_COOKIE = 'pbos_demo_used';
export const DEMO_USED_MS = 24 * 60 * 60 * 1000;
export const DEMO_MIN_SECRET = 32;
/** A cookie dated further ahead than this is treated as forged or broken. */
const MAX_FUTURE_SKEW_MS = 2 * 60 * 1000;

export type DemoSession = { sid: string; startedAt: number; expiresAt: number };
export type DemoCheck = { state: 'valid'; session: DemoSession; remainingMs: number } | { state: 'expired'; session: DemoSession } | { state: 'invalid' };

export const demoSecretOk = (secret: string | undefined): secret is string => typeof secret === 'string' && secret.length >= DEMO_MIN_SECRET;

const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function hmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function signDemoSession(session: DemoSession, secret: string): Promise<string> {
  if (!demoSecretOk(secret)) throw new Error('DEMO_SESSION_SECRET must be at least 32 characters.');
  const body = toB64url(enc.encode(JSON.stringify(session)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body)));
  return `${body}.${toB64url(sig)}`;
}

export function newDemoSession(now: number, sid: string): DemoSession {
  return { sid, startedAt: now, expiresAt: now + DEMO_MS };
}

/** Verifies the signature (constant time, inside Web Crypto), the shape, and the clock. */
export async function verifyDemoSession(value: string | undefined | null, secret: string | undefined, now: number): Promise<DemoCheck> {
  if (!value || value.length > 600 || !demoSecretOk(secret)) return { state: 'invalid' };
  const dot = value.lastIndexOf('.');
  if (dot <= 0) return { state: 'invalid' };
  const body = value.slice(0, dot);
  const sig = fromB64url(value.slice(dot + 1));
  if (!sig || sig.length !== 32) return { state: 'invalid' };
  let valid = false;
  try {
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), sig as BufferSource, enc.encode(body));
  } catch {
    return { state: 'invalid' };
  }
  if (!valid) return { state: 'invalid' };

  const raw = fromB64url(body);
  if (!raw) return { state: 'invalid' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return { state: 'invalid' };
  }
  const s = parsed as Partial<DemoSession> | null;
  if (!s || typeof s.sid !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(s.sid) || !Number.isSafeInteger(s.startedAt) || !Number.isSafeInteger(s.expiresAt)) return { state: 'invalid' };
  const session = s as DemoSession;
  // The window is always exactly DEMO_MS, so a session cannot claim a longer one even if the secret leaked and was used to sign it carelessly.
  if (session.expiresAt - session.startedAt !== DEMO_MS) return { state: 'invalid' };
  if (session.startedAt > now + MAX_FUTURE_SKEW_MS) return { state: 'invalid' };
  if (now >= session.expiresAt) return { state: 'expired', session };
  return { state: 'valid', session, remainingMs: session.expiresAt - now };
}

// ── what a request may do ──────────────────────────────────────────────────

/** Pages and APIs that exist only while the demo is open. /demo, /demo/ended and /api/demo/start stay public. */
export function isGatedDemoPath(pathname: string): boolean {
  if (pathname === '/demo/workspace' || pathname.startsWith('/demo/workspace/')) return true;
  if (pathname.startsWith('/api/demo/') && pathname !== '/api/demo/start' && pathname !== '/api/demo/start/') return true;
  return false;
}

export type DemoAccess =
  | { action: 'allow'; remainingMs: number }
  | { action: 'redirect'; to: '/demo' | '/demo/ended' }
  | { action: 'api'; status: 401 | 410 | 503; error: string };

/** The one decision function used by middleware, pages and API handlers. Public paths are always allowed. */
export async function decideDemoAccess(input: { pathname: string; cookie: string | undefined; now: number; secret: string | undefined }): Promise<DemoAccess | { action: 'public' }> {
  if (!isGatedDemoPath(input.pathname)) return { action: 'public' };
  const isApi = input.pathname.startsWith('/api/');
  if (!demoSecretOk(input.secret)) return isApi ? { action: 'api', status: 503, error: 'The demo is not available on this deployment.' } : { action: 'redirect', to: '/demo' };
  const check = await verifyDemoSession(input.cookie, input.secret, input.now);
  if (check.state === 'valid') return { action: 'allow', remainingMs: check.remainingMs };
  if (check.state === 'expired') return isApi ? { action: 'api', status: 410, error: 'The 10-minute demo has ended.' } : { action: 'redirect', to: '/demo/ended' };
  return isApi ? { action: 'api', status: 401, error: 'Start the demo first.' } : { action: 'redirect', to: '/demo' };
}
