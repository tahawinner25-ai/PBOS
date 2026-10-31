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
