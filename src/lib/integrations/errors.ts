import type { Platform } from './types';

/**
 * One error type for everything that can go wrong talking to Google or Meta.
 * `kind` drives behaviour (retry, ask the creator to reconnect, wait for the quota to reset);
 * `userMessage` is safe to show; `message` is safe to log (credentials are redacted).
 */
export type ErrorKind =
  | 'auth' //         token expired, revoked or invalid: the creator must reconnect
  | 'permission' //   missing scope, API not enabled, app not approved, account not eligible
  | 'rate_limit' //   too many calls: retry later
  | 'quota' //        a daily allowance is used up: retry after it resets
  | 'transient' //    network or 5xx: retry soon
  | 'invalid' //      the request itself is wrong (bad media, bad parameter): retrying will not help
  | 'not_found'
  | 'unknown';

export type ErrorPlatform = Platform | 'oauth-google' | 'oauth-meta' | 'image';

export class IntegrationError extends Error {
  readonly kind: ErrorKind;
  readonly platform: ErrorPlatform;
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;
  readonly retryAfterMs: number | null;
  readonly userMessage: string;

  constructor(init: {
    kind: ErrorKind;
    platform: ErrorPlatform;
    status?: number | null;
    code?: string | null;
    retryAfterMs?: number | null;
    detail?: string;
    userMessage?: string;
  }) {
    const detail = redact(init.detail ?? '').slice(0, 300);
    super(`${init.platform} ${init.kind}${init.status ? ` (HTTP ${init.status})` : ''}${init.code ? ` [${init.code}]` : ''}${detail ? `: ${detail}` : ''}`);
    this.name = 'IntegrationError';
    this.kind = init.kind;
    this.platform = init.platform;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.retryable = init.kind === 'transient' || init.kind === 'rate_limit';
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.userMessage = init.userMessage ?? defaultUserMessage(init.kind, init.platform, detail);
  }
}

const NAME: Record<string, string> = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  'oauth-google': 'Google',
  'oauth-meta': 'Meta',
  image: 'The image provider',
};

function defaultUserMessage(kind: ErrorKind, platform: ErrorPlatform, detail: string): string {
  const who = NAME[platform] ?? 'The platform';
  switch (kind) {
    case 'auth':
      return `${who} no longer accepts this connection. Reconnect it from Connections.`;
    case 'permission':
      return `${who} refused the request. A permission may be missing or the app may not be approved for this action.${detail ? ` (${detail.slice(0, 160)})` : ''}`;
    case 'rate_limit':
      return `${who} is rate limiting requests. PBOS will try again later.`;
    case 'quota':
      return `${who}'s daily allowance for this action is used up. It resets automatically; try again later.`;
    case 'transient':
      return `${who} could not be reached or had a temporary problem. PBOS will try again.`;
    case 'invalid':
      return `${who} rejected the request.${detail ? ` ${detail.slice(0, 200)}` : ''}`;
    case 'not_found':
      return `${who} could not find that item. It may have been deleted.`;
    default:
      return `${who} returned an unexpected error.`;
  }
}

/**
 * Removes anything that looks like a credential from text before it is logged or stored:
 * query-string and form tokens, bearer headers, Google (ya29., 1//) and Meta (EAA...) token shapes,
 * and long opaque secrets.
 */
export function redact(text: string): string {
  return text
    .replace(/(access_token|refresh_token|client_secret|fb_exchange_token|code|code_verifier|id_token|upload_id|signed_request)=([^&\s"']+)/gi, '$1=[redacted]')
    .replace(/("(?:access_token|refresh_token|client_secret|id_token)"\s*:\s*)"[^"]*"/gi, '$1"[redacted]"')
    .replace(/\b(Bearer|OAuth)\s+[A-Za-z0-9._~+/=-]{8,}/g, '$1 [redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b1\/\/[A-Za-z0-9._-]{20,}/g, '[redacted]')
    .replace(/\bEA[A-Za-z0-9]{30,}/g, '[redacted]');
}

type GoogleBody = {
  error?: string | { code?: number; message?: string; status?: string; errors?: Array<{ reason?: string; message?: string }> };
  error_description?: string;
};

type MetaBody = { error?: { message?: string; type?: string; code?: number; error_subcode?: number; error_user_msg?: string } };

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** `Retry-After` is either seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 3_600_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.min(Math.max(date - now, 0), 3_600_000);
}

export function classifyGoogle(platform: ErrorPlatform, status: number, text: string, retryAfterMs: number | null): IntegrationError {
  const body = (parseJson(text) ?? {}) as GoogleBody;
  const oauthCode = typeof body.error === 'string' ? body.error : null;
  const err = typeof body.error === 'object' && body.error ? body.error : null;
  const reason = err?.errors?.[0]?.reason ?? null;
  const detail = err?.message ?? body.error_description ?? '';
  const base = { platform, status, retryAfterMs, detail };

  if (oauthCode === 'invalid_grant' || oauthCode === 'unauthorized_client') return new IntegrationError({ ...base, kind: 'auth', code: oauthCode });
  if (oauthCode === 'invalid_client' || oauthCode === 'invalid_scope' || oauthCode === 'redirect_uri_mismatch') return new IntegrationError({ ...base, kind: 'permission', code: oauthCode });
  if (oauthCode) return new IntegrationError({ ...base, kind: status >= 500 ? 'transient' : 'invalid', code: oauthCode });

  if (status === 401) return new IntegrationError({ ...base, kind: 'auth', code: reason ?? 'unauthorized' });
  if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded' || reason === 'uploadLimitExceeded') return new IntegrationError({ ...base, kind: 'quota', code: reason });
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) return new IntegrationError({ ...base, kind: 'rate_limit', code: reason ?? 'rate_limited' });
  if (reason === 'youtubeSignupRequired') {
    return new IntegrationError({ ...base, kind: 'invalid', code: reason, userMessage: 'This Google account has no YouTube channel. Create a channel on YouTube, then reconnect.' });
  }
  if (reason === 'authError' || reason === 'invalidCredentials') return new IntegrationError({ ...base, kind: 'auth', code: reason });
  if (status === 403) return new IntegrationError({ ...base, kind: 'permission', code: reason ?? 'forbidden' });
  if (status === 404) return new IntegrationError({ ...base, kind: 'not_found', code: reason });
  if (status === 408 || status >= 500) return new IntegrationError({ ...base, kind: 'transient', code: reason });
  if (status >= 400) return new IntegrationError({ ...base, kind: 'invalid', code: reason });
  return new IntegrationError({ ...base, kind: 'unknown', code: reason });
}

const META_RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80005, 80006, 80008, 80009, 80014]);

export function classifyMeta(platform: ErrorPlatform, status: number, text: string, retryAfterMs: number | null): IntegrationError {
  const err = ((parseJson(text) ?? {}) as MetaBody).error ?? null;
  const code = err?.code ?? null;
  const sub = err?.error_subcode ?? null;
  const detail = err?.error_user_msg ?? err?.message ?? '';
  const codeText = code !== null ? `${code}${sub ? `/${sub}` : ''}` : null;
  const base = { platform, status, retryAfterMs, detail, code: codeText };

  if (code === 190 || code === 102) return new IntegrationError({ ...base, kind: 'auth' });
  if (code !== null && META_RATE_LIMIT_CODES.has(code)) return new IntegrationError({ ...base, kind: 'rate_limit' });
  if (code === 10 || (code !== null && code >= 200 && code <= 299) || code === 368) return new IntegrationError({ ...base, kind: 'permission' });
  // 9007: "media is not ready to publish" (container still processing). Transient by design.
  if (code === 9007 || sub === 2207027) return new IntegrationError({ ...base, kind: 'transient' });
  if (code === 1 || code === 2) return new IntegrationError({ ...base, kind: 'transient' });
  if (status === 429) return new IntegrationError({ ...base, kind: 'rate_limit' });
  if (status === 401) return new IntegrationError({ ...base, kind: 'auth' });
  if (status === 404) return new IntegrationError({ ...base, kind: 'not_found' });
  if (status === 408 || status >= 500) return new IntegrationError({ ...base, kind: 'transient' });
  if (code === 100 || status === 400) return new IntegrationError({ ...base, kind: 'invalid' });
  if (status === 403) return new IntegrationError({ ...base, kind: 'permission' });
  return new IntegrationError({ ...base, kind: status >= 400 ? 'invalid' : 'unknown' });
}

/** Builds the right IntegrationError from a failed HTTP response. Reads at most 64 KB of the body. */
export async function errorFromResponse(platform: ErrorPlatform, res: Response, now: number = Date.now()): Promise<IntegrationError> {
  const text = (await res.text().catch(() => '')).slice(0, 65_536);
  const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'), now);
  const isMeta = platform === 'instagram' || platform === 'oauth-meta';
  return isMeta ? classifyMeta(platform, res.status, text, retryAfterMs) : classifyGoogle(platform, res.status, text, retryAfterMs);
}
