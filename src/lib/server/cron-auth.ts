import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/**
 * Cron endpoints accept only `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends this header
 * automatically when CRON_SECRET is set; external schedulers and Supabase pg_cron can send it too).
 * Compared in constant time. No secret configured means every cron request is refused.
 */
export function cronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  if (secret.length < 24) return false;
  const header = request.headers.get('authorization') ?? '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
