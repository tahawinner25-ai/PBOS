import { getCreatorContext } from '@/lib/auth';
import { loadIntegrations } from '@/lib/integrations/config';
import { beginYouTubeUpload } from '@/lib/integrations/publish';
import { json, readJsonObject, sameOrigin } from '@/lib/server/http';
import { publishErrorResponse } from '@/lib/server/publish-errors';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Starts (or resumes) the upload of an APPROVED YouTube post. The engine refuses anything not approved. */
export async function POST(request: Request, { params }: { params: { jobId: string } }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'You are signed out. Sign in again.' }, 401);
  if (!UUID.test(params.jobId)) return json({ error: 'Not found.' }, 404);
  if (!rateLimit(`yt-begin:${ctx.profile.id}`, 20, 60_000).allowed) return json({ error: 'Too many attempts. Wait a minute.' }, 429);

  const body = await readJsonObject(request, 2_000);
  const size = typeof body?.size === 'number' ? body.size : NaN;
  const mime = typeof body?.mime === 'string' ? body.mime : '';
  if (!Number.isSafeInteger(size)) return json({ error: 'The file size is missing.' }, 400);

  const setup = loadIntegrations();
  if (!setup.ok) return json({ error: 'Publishing is not set up on this deployment yet.' }, 503);
  try {
    const result = await beginYouTubeUpload(setup.env, ctx.profile.id, params.jobId, { size, mime });
    if ('done' in result && result.done) return json({ done: true, url: result.job.external_url });
    return json(result);
  } catch (err) {
    return publishErrorResponse(err);
  }
}
