import { getCreatorContext } from '@/lib/auth';
import { loadIntegrations } from '@/lib/integrations/config';
import { UPLOAD_CHUNK_BYTES, pushYouTubeChunk } from '@/lib/integrations/publish';
import { json, sameOrigin } from '@/lib/server/http';
import { publishErrorResponse } from '@/lib/server/publish-errors';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Receives one chunk (at most 3 MiB, under Vercel's request-body limit) and forwards it to YouTube. */
export async function PUT(request: Request, { params }: { params: { jobId: string } }) {
  if (!sameOrigin(request)) return json({ error: 'Cross-site requests are not allowed.' }, 403);
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'You are signed out. Sign in again.' }, 401);
  if (!UUID.test(params.jobId)) return json({ error: 'Not found.' }, 404);
  if (!rateLimit(`yt-chunk:${ctx.profile.id}`, 900, 60_000).allowed) return json({ error: 'Too many requests. Slow down.' }, 429);

  const offset = Number(new URL(request.url).searchParams.get('offset'));
  if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: 'The upload position is invalid.' }, 400);
  // Refuse oversized bodies before reading them when the client declared a length.
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > UPLOAD_CHUNK_BYTES) return json({ error: 'That chunk is too large.' }, 413);
  const buf = new Uint8Array(await request.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > UPLOAD_CHUNK_BYTES) return json({ error: 'That chunk has an invalid size.' }, 413);

  const setup = loadIntegrations();
  if (!setup.ok) return json({ error: 'Publishing is not set up on this deployment yet.' }, 503);
  try {
    const result = await pushYouTubeChunk(setup.env, ctx.profile.id, params.jobId, offset, buf);
    if (result.done) return json({ done: true, url: result.job.external_url, status: result.job.status, keptPrivate: result.job.error_code === 'kept_private' });
    return json({ done: false, nextOffset: result.nextOffset, progress: result.progress });
  } catch (err) {
    return publishErrorResponse(err);
  }
}
