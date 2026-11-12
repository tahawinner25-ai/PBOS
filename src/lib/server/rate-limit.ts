import 'server-only';

/**
 * Best-effort in-memory rate limiter. On serverless platforms each instance keeps its own
 * counters, so this slows casual abuse (and runaway LLM spend) but is not a hard guarantee.
 * Put a shared limiter (Upstash, Vercel WAF) in front for strict limits.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 5000) {
      buckets.forEach((v, k) => {
        if (v.resetAt <= now) buckets.delete(k);
      });
    }
    return { allowed: true, retryAfterSec: 0 };
  }
  bucket.count += 1;
  return { allowed: bucket.count <= limit, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
}

/**
 * Double-submit guard: true when the very same content was already sent by the same person a moment ago (a double
 * click, a retry on a slow connection, a second tab). Best effort and per server instance, like the limiter above.
 * Fingerprint the form with formFingerprint().
 */
const recentSubmits = new Map<string, number>();
export function isDuplicateSubmit(key: string, windowMs = 4000, now = Date.now()): boolean {
  const last = recentSubmits.get(key);
  if (last !== undefined && now - last < windowMs) return true;
  recentSubmits.set(key, now);
  if (recentSubmits.size > 5000) recentSubmits.forEach((t, k) => { if (now - t >= windowMs) recentSubmits.delete(k); });
  return false;
}

export function formFingerprint(formData: FormData): string {
  const parts: string[] = [];
  formData.forEach((v, k) => { if (typeof v === 'string') parts.push(`${k}=${v}`); });
  return parts.sort().join('&').slice(0, 4000);
}
