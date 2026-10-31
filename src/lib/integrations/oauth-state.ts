import { createHash, randomBytes } from 'node:crypto';
import { b64url, packSigned, safeEqual, unpackSigned } from '../signing';
import type { Platform } from './types';

/**
 * OAuth `state` and PKCE for the connect flows.
 *
 * Start:    we create a random nonce (the `state` sent to the provider) and a PKCE verifier. Both go into
 *           one HMAC-signed, httpOnly cookie bound to the signed-in creator and the platform.
 * Callback: the provider returns `state`. We accept the callback only if the cookie is genuine, not
 *           expired, for this platform and this creator, and its nonce equals the returned `state`.
 *
 * This blocks login CSRF (an attacker making a victim connect the attacker's account), replayed
 * callbacks (the cookie is deleted after use), and cross-account mix-ups.
 */

export const OAUTH_COOKIE = 'pbos_oauth';
export const OAUTH_STATE_TTL_SEC = 600;

type CookiePayload = {
  /** nonce, equal to the `state` query parameter */
  n: string;
  /** platform */
  p: Platform;
  /** creator id */
  c: string;
  /** PKCE code verifier */
  v: string;
  /** expiry, epoch milliseconds */
  exp: number;
};

export type CreatedState = {
  state: string;
  codeChallenge: string;
  cookieValue: string;
  maxAgeSec: number;
};

export type StateFailure = 'missing' | 'bad_signature' | 'expired' | 'state_mismatch' | 'platform_mismatch' | 'creator_mismatch';

export function pkcePair(random: (n: number) => Buffer = randomBytes): { verifier: string; challenge: string } {
  const verifier = b64url(random(48)); // 64 characters, inside RFC 7636's 43..128
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function createOAuthState(args: {
  creatorId: string;
  platform: Platform;
  secret: string;
  now?: number;
  random?: (n: number) => Buffer;
}): CreatedState {
  const random = args.random ?? randomBytes;
  const now = args.now ?? Date.now();
  const nonce = b64url(random(24));
  const pkce = pkcePair(random);
  const payload: CookiePayload = { n: nonce, p: args.platform, c: args.creatorId, v: pkce.verifier, exp: now + OAUTH_STATE_TTL_SEC * 1000 };
  return { state: nonce, codeChallenge: pkce.challenge, cookieValue: packSigned(payload, args.secret), maxAgeSec: OAUTH_STATE_TTL_SEC };
}

export function verifyOAuthState(args: {
  cookieValue: string | undefined;
  stateParam: string | null | undefined;
  platform: Platform;
  creatorId: string;
  secret: string;
  now?: number;
}): { ok: true; codeVerifier: string } | { ok: false; reason: StateFailure } {
  if (!args.cookieValue || !args.stateParam) return { ok: false, reason: 'missing' };
  const payload = unpackSigned<CookiePayload>(args.cookieValue, args.secret);
  if (!payload || typeof payload.n !== 'string' || typeof payload.v !== 'string') return { ok: false, reason: 'bad_signature' };
  if (!(payload.exp > (args.now ?? Date.now()))) return { ok: false, reason: 'expired' };
  if (!safeEqual(payload.n, args.stateParam)) return { ok: false, reason: 'state_mismatch' };
  if (payload.p !== args.platform) return { ok: false, reason: 'platform_mismatch' };
  if (payload.c !== args.creatorId) return { ok: false, reason: 'creator_mismatch' };
  return { ok: true, codeVerifier: payload.v };
}
