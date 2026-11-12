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
