import { cronAuthorized } from '@/lib/server/cron-auth';
import { json } from '@/lib/server/http';
import { refreshConnection } from '@/lib/integrations/connections';
import { loadIntegrations } from '@/lib/integrations/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Renews tokens ahead of time (Google access tokens hourly; Meta's 60-day token inside its last 14 days). */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, 401);
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: false, missing: setup.missing }, 503);
  const { env } = setup;
  const horizon = new Date(env.deps.now().getTime() + 14 * 86_400_000).toISOString();
  const candidates = await env.conns.listRefreshCandidates(horizon);
  const started = Date.now();
  const tally = { refreshed: 0, needs_reauth: 0, skipped: 0, error: 0 };
  for (const c of candidates) {
    if (Date.now() - started > 45_000) break;
    const result = await refreshConnection({ deps: env.deps, conns: env.conns, events: env.events, creatorId: c.creatorId, platform: c.platform, google: env.google, meta: env.meta });
    tally[result] += 1;
  }
  return json({ ok: true, checked: candidates.length, ...tally });
}
export const GET = handle;
export const POST = handle;
