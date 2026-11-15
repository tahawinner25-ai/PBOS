import { cronAuthorized } from '@/lib/server/cron-auth';
import { json } from '@/lib/server/http';
import { loadIntegrations } from '@/lib/integrations/config';
import { sweepStuckJobs } from '@/lib/integrations/publish';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Parks interrupted Instagram publishes for review and expires abandoned YouTube uploads. */
async function handle(request: Request) {
  if (!cronAuthorized(request)) return json({ error: 'unauthorized' }, 401);
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: false, missing: setup.missing }, 503);
  const swept = await sweepStuckJobs(setup.env);
  // Old operational logs are deleted on a schedule (retention). Failure here must not fail the sweep.
  const purged = await createAdminClient()?.rpc('purge_old_rows').then((r) => (r.error ? null : r.data), () => null);
  return json({ ok: true, ...swept, purged: purged ?? null });
}
export const GET = handle;
export const POST = handle;
