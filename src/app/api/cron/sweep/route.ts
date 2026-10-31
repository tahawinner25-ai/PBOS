import { cronAuthorized } from '@/lib/server/cron-auth';
import { json } from '@/lib/server/http';
import { loadIntegrations } from '@/lib/integrations/config';
import { sweepStuckJobs } from '@/lib/integrations/publish';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Parks interrupted Instagram publishes for review and expires abandoned YouTube uploads. */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, 401);
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: false, missing: setup.missing }, 503);
  return json({ ok: true, ...(await sweepStuckJobs(setup.env)) });
}
export const GET = handle;
export const POST = handle;
