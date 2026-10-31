import { cronAuthorized } from '@/lib/server/cron-auth';
import { json } from '@/lib/server/http';
import { syncCreator } from '@/lib/integrations/analytics-sync';
import { loadIntegrations } from '@/lib/integrations/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Pulls fresh YouTube and Instagram numbers for every connected creator (a few per run, within a time budget). */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, 401);
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: false, missing: setup.missing }, 503);
  const { env } = setup;
  const active = await env.conns.listActive();
  const byCreator = new Map<string, Array<'youtube' | 'instagram'>>();
  for (const a of active) byCreator.set(a.creatorId, [...(byCreator.get(a.creatorId) ?? []), a.platform]);
  const started = Date.now();
  let synced = 0;
  let failed = 0;
  for (const [creatorId, platforms] of byCreator) {
    if (Date.now() - started > 40_000) break;
    for (const s of await syncCreator(env, creatorId, platforms)) (s.ok ? synced++ : failed++);
  }
  return json({ ok: true, creators: byCreator.size, synced, failed });
}
export const GET = handle;
export const POST = handle;
