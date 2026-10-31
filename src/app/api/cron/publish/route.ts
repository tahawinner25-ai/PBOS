import { cronAuthorized } from '@/lib/server/cron-auth';
import { json } from '@/lib/server/http';
import { loadIntegrations } from '@/lib/integrations/config';
import { runDueInstagramJobs } from '@/lib/integrations/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Publishes approved Instagram posts that are due. Instagram has no scheduling API, so this is what makes "schedule" work. */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, 401);
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: false, missing: setup.missing }, 503);
  const out = await runDueInstagramJobs(setup.env, { limit: 5, budgetMs: 50_000 });
  return json({ ok: true, ...out });
}
export const GET = handle;
export const POST = handle;
