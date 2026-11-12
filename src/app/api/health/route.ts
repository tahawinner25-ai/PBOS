import { NextResponse } from 'next/server';
import { clientIp } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 10;

/**
 * Public health check for uptime monitors. It reveals nothing about users or settings: only whether the app answers
 * and, when the database key is set, whether the database does. Returns 503 when the database does not answer so a
 * monitor can alert.
 */
export async function GET(request: Request) {
  // A monitor polls every few minutes; this only stops someone hammering the database check.
  const limit = rateLimit(`health:${clientIp(request)}`, 60, 60_000);
  if (!limit.allowed) return NextResponse.json({ ok: false, error: 'Too many requests' }, { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } });
  const started = Date.now();
  const admin = createAdminClient();
  let db: 'ok' | 'down' | 'not_configured' = 'not_configured';
  if (admin) {
    try {
      const res = await Promise.race([
        admin.from('creator_profile').select('id', { head: true, count: 'exact' }).limit(1),
        new Promise<{ error: { message: string } }>((resolve) => setTimeout(() => resolve({ error: { message: 'timeout' } }), 4000)),
      ]);
      db = res.error ? 'down' : 'ok';
    } catch {
      db = 'down';
    }
  }
  const healthy = db !== 'down';
  return NextResponse.json({ ok: healthy, db, ms: Date.now() - started, time: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
