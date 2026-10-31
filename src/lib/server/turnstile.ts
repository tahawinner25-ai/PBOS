const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare documents a 2048 character ceiling for a Turnstile response token. */
const MAX_TOKEN_LENGTH = 2048;

export type TurnstileConfig = 'off' | 'on' | 'misconfigured';

/**
 * The widget needs the public site key and the server check needs the secret key. Both must be set
 * together: a site key alone would show a widget that nothing verifies, and a secret alone would
 * reject every submission because no widget is shown.
 */
export function turnstileConfig(siteKey: string | undefined, secret: string | undefined): TurnstileConfig {
  const hasSite = Boolean(siteKey?.trim());
  const hasSecret = Boolean(secret?.trim());
  if (hasSite && hasSecret) return 'on';
  if (!hasSite && !hasSecret) return 'off';
  return 'misconfigured';
}

export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'rejected' | 'unavailable' };

type Fetcher = (url: string, init: { method: string; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Verifies a Cloudflare Turnstile token on the server. It fails closed: a token that cannot be checked
 * (network error, timeout, bad reply) is never treated as valid.
 */
export async function verifyTurnstile(input: {
  token: unknown;
  secret: string;
  ip?: string;
  fetchImpl?: Fetcher;
  timeoutMs?: number;
}): Promise<TurnstileResult> {
  const { token, secret, ip, timeoutMs = 5000 } = input;
  if (typeof token !== 'string' || token.trim() === '' || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: 'missing' };

  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);

  const fetcher = input.fetchImpl ?? (fetch as unknown as Fetcher);
  try {
    const res = await fetcher(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const data = (await res.json()) as { success?: unknown };
    return data && data.success === true ? { ok: true } : { ok: false, reason: 'rejected' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
