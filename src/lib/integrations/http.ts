import { IntegrationError, errorFromResponse, type ErrorPlatform } from './errors';
import type { Deps } from './types';

/**
 * HTTP with the behaviour every platform call needs: a timeout, retries with exponential backoff and
 * jitter for failures that can heal (network, 5xx, rate limits), `Retry-After` honoured, and every
 * failure turned into an IntegrationError whose text has had credentials removed.
 *
 * Non-idempotent calls (Instagram `media_publish`) must pass `maxAttempts: 1`: after a timeout the
 * request may already have been applied, and a blind retry could post twice.
 */

export type RequestOptions = {
  platform: ErrorPlatform;
  /** Total tries including the first. Default 3. */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout. Default 30 s. */
  timeoutMs?: number;
  /** Extra statuses that are a success (YouTube's resumable upload answers 308 "resume incomplete"). */
  okStatuses?: number[];
  /** Called with every response (success or not), for example to read Meta's usage headers. */
  onResponse?: (res: Response) => void;
};

const DEFAULTS = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 8_000, timeoutMs: 30_000 };

/** Exponential backoff with "equal jitter": half fixed, half random, capped. Pure, so it is testable. */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

export async function request(deps: Deps, url: string, init: RequestInit, options: RequestOptions): Promise<Response> {
  const max = Math.max(1, options.maxAttempts ?? DEFAULTS.maxAttempts);
  const base = options.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const cap = options.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const timeout = options.timeoutMs ?? DEFAULTS.timeoutMs;
  let last: IntegrationError | null = null;

  for (let attempt = 1; attempt <= max; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await deps.fetch(url, { ...init, signal: controller.signal });
      options.onResponse?.(res);
      if (res.ok || options.okStatuses?.includes(res.status)) return res;
      last = await errorFromResponse(options.platform, res, deps.now().getTime());
    } catch (cause) {
      if (cause instanceof IntegrationError) throw cause;
      const aborted = cause instanceof Error && cause.name === 'AbortError';
      last = new IntegrationError({
        kind: 'transient',
        platform: options.platform,
        code: aborted ? 'timeout' : 'network',
        detail: aborted ? `no response within ${timeout} ms` : 'network error',
      });
    } finally {
      clearTimeout(timer);
    }

    if (!last.retryable || attempt === max) throw last;
    // Respect the server's hint, but never sleep longer than the cap inside one request.
    const wait = last.retryAfterMs !== null ? Math.min(last.retryAfterMs, cap) : backoffDelay(attempt, base, cap, deps.random);
    await deps.sleep(wait);
  }
  /* c8 ignore next */
  throw last ?? new IntegrationError({ kind: 'unknown', platform: options.platform });
}

export async function requestJson<T>(deps: Deps, url: string, init: RequestInit, options: RequestOptions): Promise<T> {
  const res = await request(deps, url, init, options);
  const text = await res.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new IntegrationError({ kind: 'unknown', platform: options.platform, status: res.status, detail: 'response was not JSON' });
  }
}

export const formBody = (fields: Record<string, string | number | boolean | undefined | null>): URLSearchParams => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  return params;
};
