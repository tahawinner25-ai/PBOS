import { NotConnectedError, ReauthRequiredError, getInstagramCreds, getYouTubeToken } from './connections';
import { IntegrationError } from './errors';
import {
  createContainer, getContainerStatus, getMedia, getPublishingLimit, publishContainer, usageShouldBackOff,
  type ContainerRequest, type ContainerStatus, type MetaUsage,
} from './meta';
import type { Env, JobPatch, NewPost } from './ports';
import { reserveYoutube } from './quota';
import { PLATFORM_LABEL, type JobStatus, type MediaAssetRow, type PublishJob } from './types';
import { YOUTUBE_VIDEO_MIME } from './validate';
import { queryUploadStatus, startResumableUpload, uploadChunk, type UploadProgress, type YouTubeVideoResource } from './youtube';

/**
 * Publishing engine. Two flows, one rule: only a job the creator approved (approved_at set) is ever
 * touched, and a job whose outcome is uncertain is parked as `needs_review`, never retried.
 *
 * YouTube: resumable upload. The browser reads the file in chunks and posts each chunk to our API;
 * we forward it to Google. The access token never reaches the browser, files are never stored on our
 * side (no size limit from our storage), and the browser can resume after a dropped connection.
 * Scheduling uses YouTube's own `publishAt`, so a scheduled YouTube video needs no background job.
 *
 * Instagram: Meta fetches the media from a short-lived signed URL. Step 1 creates a container (for a
 * carousel: one per item, then one for the carousel), then we poll its status. Step 2, `media_publish`,
 * runs once the container is FINISHED. Instagram has no scheduling API, so scheduled posts are picked
 * up by the cron job when they are due.
 */

export class JobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobStateError';
  }
}

export class OffsetMismatchError extends Error {
  constructor(readonly expected: number) {
    super(`upload offset mismatch, expected ${expected}`);
    this.name = 'OffsetMismatchError';
  }
}

/** YouTube accepts files up to 256 GB. */
export const MAX_YOUTUBE_BYTES = 256 * 1024 ** 3;
/** Browser-to-server chunk: a multiple of 256 KiB and under Vercel's 4.5 MB request-body limit. */
export const UPLOAD_CHUNK_BYTES = 12 * 256 * 1024;

const FORMAT_LABEL: Record<string, string> = { video: 'Long video', short: 'Short video', reel: 'Short video', photo: 'Image post', carousel: 'Carousel' };
const watchUrl = (job: PublishJob, id: string) => (job.format === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`);

function postFromJob(job: PublishJob, externalId: string, url: string | null, publishedAt: string): NewPost {
  return {
    platform: PLATFORM_LABEL[job.platform],
    format: FORMAT_LABEL[job.format] ?? 'Other',
    title: job.title ?? (job.caption ? job.caption.slice(0, 80) : null),
    published_at: publishedAt,
    external_id: externalId,
    external_url: url,
    source: job.platform,
    idea_id: job.idea_id,
  };
}

async function failJob(env: Env, job: PublishJob, err: IntegrationError | Error, code: string, patch: JobPatch = {}): Promise<PublishJob | null> {
  const message = err instanceof IntegrationError ? err.userMessage : err.message;
  const updated = await env.jobs.update(job.creator_id, job.id, { status: 'failed', error_code: code, last_error: message.slice(0, 480), locked_until: null, next_attempt_at: null, ...patch });
  await env.events.record(job.creator_id, job.platform, 'publish_failed', { job: job.id, code, kind: err instanceof IntegrationError ? err.kind : 'internal' });
  return updated;
}

// ════════════════════════════════ YouTube ════════════════════════════════

export type UploadStart = { offset: number; chunkSize: number; resumed: boolean; done?: false } | { done: true; job: PublishJob };

/** Starts (or resumes) the resumable upload for an approved YouTube job. The file itself comes later, chunk by chunk. */
export async function beginYouTubeUpload(env: Env, creatorId: string, jobId: string, file: { size: number; mime: string }): Promise<UploadStart> {
  const job = await env.jobs.get(creatorId, jobId);
  if (!job) throw new JobStateError('That post was not found.');
  if (job.platform !== 'youtube') throw new JobStateError('That is not a YouTube post.');
  if (!job.approved_at) throw new JobStateError('Approve the post before uploading.');
  if (job.status !== 'scheduled' && job.status !== 'uploading') throw new JobStateError(`This post is ${job.status.replace('_', ' ')} and cannot be uploaded now.`);
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_YOUTUBE_BYTES) throw new JobStateError('The video file size is not valid.');
  if (!YOUTUBE_VIDEO_MIME.includes(file.mime)) throw new JobStateError('YouTube accepts MP4, MOV, WebM, MKV and AVI videos.');
  if (!env.google) throw new JobStateError('YouTube is not configured on this deployment.');

  // Resume an interrupted upload of the same file.
  if (job.status === 'uploading' && job.upload_session_uri && job.upload_size === file.size) {
    try {
      const progress = await queryUploadStatus(env.deps, { sessionUri: job.upload_session_uri, total: file.size });
      return await applyProgress(env, job, progress, true);
    } catch (err) {
      // An expired or unknown session means we start a new one below; anything else is a real error.
      if (!(err instanceof IntegrationError) || (err.kind !== 'not_found' && err.kind !== 'invalid')) throw err;
    }
  }

  const reservation = await reserveYoutube(env.quota, { creatorId, bucket: 'uploads', units: 1, config: env.quotaConfig, now: env.deps.now() });
  if (!reservation.ok) {
    const when = reservation.retryAt.toISOString();
    const error = new IntegrationError({ kind: 'quota', platform: 'youtube', code: 'upload_quota', userMessage: `YouTube's upload allowance for today is used up (${reservation.used} of ${reservation.limit}). It resets at ${when}.` });
    await env.jobs.update(creatorId, jobId, { last_error: error.userMessage.slice(0, 480), error_code: 'quota' });
    throw error;
  }

  const { token } = await getYouTubeToken({ deps: env.deps, conns: env.conns, events: env.events, google: env.google, creatorId });
  const sessionUri = await startResumableUpload(env.deps, token, {
    size: file.size,
    mime: file.mime,
    metadata: {
      title: job.title ?? '',
      description: job.caption ?? '',
      tags: job.tags,
      privacy: job.privacy,
      publishAt: job.scheduled_for,
      madeForKids: job.made_for_kids === true,
      isShort: job.format === 'short',
    },
  });
  const updated = await env.jobs.update(creatorId, jobId, {
    status: 'uploading', upload_session_uri: sessionUri, upload_size: file.size, upload_mime: file.mime, upload_offset: 0, progress: 0,
    attempts: job.attempts + 1, last_error: null, error_code: null,
  }, ['scheduled', 'uploading']);
  if (!updated) throw new JobStateError('The post changed while the upload was starting. Try again.');
  await env.events.record(creatorId, 'youtube', 'upload_started', { job: jobId, bytes: file.size });
  return { offset: 0, chunkSize: UPLOAD_CHUNK_BYTES, resumed: false };
}

async function applyProgress(env: Env, job: PublishJob, progress: UploadProgress, resumed: boolean): Promise<UploadStart> {
  if (progress.done) return { done: true, job: await finalizeYouTube(env, job, progress.video) };
  const size = job.upload_size ?? 1;
  await env.jobs.update(job.creator_id, job.id, { upload_offset: progress.nextOffset, progress: Math.min(99, Math.floor((progress.nextOffset / size) * 100)) }, ['uploading']);
  return { offset: progress.nextOffset, chunkSize: UPLOAD_CHUNK_BYTES, resumed };
}

export type ChunkResult = { done: false; nextOffset: number; progress: number } | { done: true; job: PublishJob };

/** Forwards one chunk to YouTube. The offset must be where the server expects the next byte. */
export async function pushYouTubeChunk(env: Env, creatorId: string, jobId: string, offset: number, bytes: Uint8Array): Promise<ChunkResult> {
  const job = await env.jobs.get(creatorId, jobId);
  if (!job || job.platform !== 'youtube') throw new JobStateError('That post was not found.');
  if (!job.approved_at || job.status !== 'uploading' || !job.upload_session_uri || !job.upload_size) throw new JobStateError('This post is not waiting for an upload.');
  if (offset !== job.upload_offset) throw new OffsetMismatchError(job.upload_offset);

  let progress: UploadProgress;
  try {
    progress = await uploadChunk(env.deps, { sessionUri: job.upload_session_uri, chunk: bytes, offset, total: job.upload_size, mime: job.upload_mime ?? 'video/mp4' });
  } catch (err) {
    if (err instanceof IntegrationError && err.kind !== 'transient' && err.kind !== 'rate_limit') {
      await failJob(env, job, err, err.kind === 'quota' ? 'quota' : 'upload_rejected');
    }
    throw err;
  }
  if (progress.done) return { done: true, job: await finalizeYouTube(env, job, progress.video) };
  const pct = Math.min(99, Math.floor((progress.nextOffset / job.upload_size) * 100));
  await env.jobs.update(creatorId, jobId, { upload_offset: progress.nextOffset, progress: pct }, ['uploading']);
  return { done: false, nextOffset: progress.nextOffset, progress: pct };
}

/** Records the result Google actually returned. If Google kept the video private, we say so. */
export async function finalizeYouTube(env: Env, job: PublishJob, video: YouTubeVideoResource): Promise<PublishJob> {
  const scheduledLater = job.scheduled_for !== null && Date.parse(job.scheduled_for) > env.deps.now().getTime();
  const actual = video.status?.privacyStatus ?? null;
  const wantedPublic = !scheduledLater && job.privacy !== 'private';
  const lockedPrivate = wantedPublic && actual === 'private';
  const url = watchUrl(job, video.id);
  const publishedAt = (scheduledLater ? job.scheduled_for : null) ?? env.deps.now().toISOString();
  const postId = await env.posts.createFromJob(job.creator_id, postFromJob(job, video.id, url, publishedAt));
  if (job.idea_id) await env.posts.markIdeaPosted(job.creator_id, job.idea_id);
  const updated = await env.jobs.update(job.creator_id, job.id, {
    status: scheduledLater ? 'platform_scheduled' : 'published',
    external_id: video.id,
    external_url: url,
    progress: 100,
    upload_offset: job.upload_size ?? job.upload_offset,
    upload_session_uri: null,
    published_at: publishedAt,
    post_id: postId,
    locked_until: null,
    error_code: lockedPrivate ? 'kept_private' : null,
    last_error: lockedPrivate
      ? 'YouTube kept this video private. If your Google API project has not passed YouTube\'s API compliance audit, uploads are locked to private until it does.'
      : null,
  });
  await env.events.record(job.creator_id, 'youtube', scheduledLater ? 'upload_scheduled' : 'upload_published', { job: job.id, video: video.id, privacy: actual });
  return updated ?? job;
}

// ═══════════════════════════════ Instagram ═══════════════════════════════

const SIGNED_URL_TTL_SEC = 3600;
const RETRY_DELAYS_MS = [60_000, 2 * 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 4_000;

export type RunOutcome = 'skipped' | 'published' | 'processing' | 'rescheduled' | 'failed' | 'needs_review';
export type RunResult = { outcome: RunOutcome; job: PublishJob | null; note?: string };

export type RunOptions = { pollBudgetMs?: number; lockMs?: number };

const isDue = (job: PublishJob, now: number) => !job.scheduled_for || Date.parse(job.scheduled_for) <= now;

function expectedContainers(job: PublishJob): number {
  return job.format === 'carousel' ? job.media_asset_ids.length + 1 : 1;
}

async function reschedule(env: Env, job: PublishJob, delayMs: number, note: string, extra: JobPatch = {}): Promise<RunResult> {
  const updated = await env.jobs.update(job.creator_id, job.id, {
    next_attempt_at: new Date(env.deps.now().getTime() + delayMs).toISOString(), locked_until: null, last_error: note.slice(0, 480), ...extra,
  }, ['scheduled', 'processing']);
  return { outcome: 'rescheduled', job: updated, note };
}

async function pollContainer(env: Env, creds: { pageToken: string; ctx: Parameters<typeof getContainerStatus>[0] }, id: string, budgetMs: number): Promise<{ status: ContainerStatus; detail: string | null }> {
  const started = env.deps.now().getTime();
  for (;;) {
    const result = await getContainerStatus(creds.ctx, creds.pageToken, id);
    if (result.status !== 'IN_PROGRESS' && result.status !== 'UNKNOWN') return result;
    if (env.deps.now().getTime() - started + POLL_INTERVAL_MS > budgetMs) return { status: 'IN_PROGRESS', detail: result.detail };
    await env.deps.sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Advances one Instagram job as far as it can in this invocation. Safe to call repeatedly: every
 * step is recorded before the next begins, so a crash resumes instead of repeating.
 */
export async function runInstagramJob(env: Env, creatorId: string, jobId: string, options: RunOptions = {}): Promise<RunResult> {
  const now = env.deps.now();
  const claimed = await env.jobs.claim(creatorId, jobId, now, options.lockMs ?? 120_000, ['scheduled', 'processing']);
  if (!claimed) return { outcome: 'skipped', job: null, note: 'not claimable' };
  let job = claimed;
  // Two independent guards: only approved jobs run, and only when due.
  if (!job.approved_at) {
    await env.jobs.update(creatorId, jobId, { locked_until: null });
    return { outcome: 'skipped', job, note: 'not approved' };
  }
  if (!isDue(job, now.getTime()) && job.status === 'scheduled') {
    await env.jobs.update(creatorId, jobId, { locked_until: null }, ['scheduled']);
    return { outcome: 'skipped', job, note: 'not due yet' };
  }
  if (!env.meta) return { outcome: 'failed', job: await failJob(env, job, new Error('Instagram is not configured on this deployment.'), 'not_configured') };

  let usage: MetaUsage | null = null;
  try {
    const creds = await getInstagramCreds({ deps: env.deps, conns: env.conns, events: env.events, meta: env.meta, creatorId, onUsage: (u) => { usage = u; } });
    const rows = await env.media.get(creatorId, job.media_asset_ids);
    const ordered = job.media_asset_ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is MediaAssetRow => Boolean(r));
    if (ordered.length !== job.media_asset_ids.length || ordered.length === 0) {
      return { outcome: 'failed', job: await failJob(env, job, new Error('A file attached to this post no longer exists. Re-attach it and retry.'), 'media_missing') };
    }
    const containsAi = ordered.some((m) => m.ai_generated);
    const budget = options.pollBudgetMs ?? 40_000;

    // Meta's own 24-hour counter decides whether we may publish at all.
    if (job.container_ids.length === 0) {
      const limit = await getPublishingLimit(creds.ctx, creds.pageToken, creds.igUserId);
      if (limit.used >= limit.total) {
        return reschedule(env, job, 30 * 60_000, `Instagram's 24-hour publishing limit is reached (${limit.used} of ${limit.total}). PBOS will try again in 30 minutes.`);
      }
    }

    const save = async (patch: JobPatch) => {
      const next = await env.jobs.update(creatorId, jobId, patch, ['scheduled', 'processing']);
      if (!next) throw new JobStateError('The post changed while it was being published.');
      job = next;
    };
    const urls = async () => Promise.all(ordered.map((m) => env.media.signedUrl(m, SIGNED_URL_TTL_SEC)));
    const caption = job.caption ?? undefined;
    const ids = [...job.container_ids];
    let finalId: string;

    // ── step 1: containers ──
    if (job.format === 'photo' || job.format === 'reel') {
      if (ids.length === 0) {
        const [url] = await urls();
        const req: ContainerRequest = job.format === 'photo' ? { kind: 'photo', imageUrl: url, caption, aiGenerated: containsAi } : { kind: 'reel', videoUrl: url, caption, aiGenerated: containsAi };
        ids.push(await createContainer(creds.ctx, creds.pageToken, creds.igUserId, req));
        await save({ container_ids: ids, status: 'processing' });
      }
      finalId = ids[0];
    } else {
      const n = ordered.length;
      if (ids.length < n) {
        const signed = await urls();
        for (let i = ids.length; i < n; i += 1) {
          ids.push(await createContainer(creds.ctx, creds.pageToken, creds.igUserId, { kind: 'carousel_item', mediaType: ordered[i].kind, url: signed[i] }));
          await save({ container_ids: ids, status: 'processing' });
        }
      }
      if (ids.length === n) {
        // Children must be ready before the carousel container can be created.
        for (const child of ids) {
          const state = await pollContainer(env, creds, child, budget);
          if (state.status === 'ERROR' || state.status === 'EXPIRED') {
            return { outcome: 'failed', job: await failJob(env, job, new Error(`Instagram could not process one of the carousel items (${state.status.toLowerCase()}${state.detail ? `: ${state.detail}` : ''}).`), 'container_error') };
          }
          if (state.status !== 'FINISHED') return reschedule(env, job, 60_000, 'Instagram is still processing the carousel items.', { status: 'processing' });
        }
        ids.push(await createContainer(creds.ctx, creds.pageToken, creds.igUserId, { kind: 'carousel', children: ids.slice(0, n), caption, aiGenerated: containsAi }));
        await save({ container_ids: ids, status: 'processing' });
      }
      finalId = ids[n];
    }

    if (usageShouldBackOff(usage)) return reschedule(env, job, 15 * 60_000, 'Meta asked apps to slow down. PBOS will try again in 15 minutes.');

    // ── step 2: wait for the container, then publish exactly once ──
    const state = await pollContainer(env, creds, finalId, budget);
    if (state.status === 'ERROR' || state.status === 'EXPIRED') {
      return { outcome: 'failed', job: await failJob(env, job, new Error(`Instagram could not process the media (${state.status.toLowerCase()}${state.detail ? `: ${state.detail}` : ''}). Check the format and try again.`), state.status === 'EXPIRED' ? 'container_expired' : 'container_error') };
    }
    if (state.status === 'PUBLISHED') {
      // Meta says it is already published but we have no media id: outcome unclear, never publish again.
      return { outcome: 'needs_review', job: await markNeedsReview(env, job, 'Instagram reports this post as already published. Check your profile before doing anything else.') };
    }
    if (state.status !== 'FINISHED') {
      const updated = await env.jobs.update(creatorId, jobId, { status: 'processing', next_attempt_at: new Date(env.deps.now().getTime() + 30_000).toISOString(), locked_until: null }, ['scheduled', 'processing']);
      return { outcome: 'processing', job: updated };
    }

    // Record intent BEFORE the call. "uploading" means media_publish is in flight for Instagram jobs.
    const inFlight = await env.jobs.update(creatorId, jobId, { status: 'uploading', progress: 90, attempts: job.attempts + 1 }, ['scheduled', 'processing']);
    if (!inFlight) return { outcome: 'skipped', job, note: 'changed before publishing' };
    job = inFlight;
    let mediaId: string;
    try {
      mediaId = await publishContainer(creds.ctx, creds.pageToken, creds.igUserId, finalId);
    } catch (err) {
      if (err instanceof IntegrationError && (err.kind === 'auth' || err.kind === 'permission' || err.kind === 'invalid' || err.kind === 'not_found')) {
        if (err.kind === 'auth') await env.conns.update(creatorId, 'instagram', { status: 'needs_reauth', lastError: err.userMessage.slice(0, 480) });
        return { outcome: 'failed', job: await failJob(env, job, err, err.kind) };
      }
      // Timeout, 5xx, rate limit or anything else: Meta may or may not have published. Do not retry.
      return { outcome: 'needs_review', job: await markNeedsReview(env, job, 'Instagram did not confirm whether this post was published. Check your profile; PBOS will not retry automatically so it cannot post twice.') };
    }

    const permalink = await getMedia(creds.ctx, creds.pageToken, mediaId).then((m) => m.permalink).catch(() => null);
    const publishedAt = env.deps.now().toISOString();
    const postId = await env.posts.createFromJob(creatorId, postFromJob(job, mediaId, permalink, publishedAt));
    if (job.idea_id) await env.posts.markIdeaPosted(creatorId, job.idea_id);
    const done = await env.jobs.update(creatorId, jobId, {
      status: 'published', external_id: mediaId, external_url: permalink, progress: 100, published_at: publishedAt, post_id: postId,
      locked_until: null, next_attempt_at: null, last_error: null, error_code: null,
    });
    await env.events.record(creatorId, 'instagram', 'publish_succeeded', { job: jobId, media: mediaId });
    return { outcome: 'published', job: done };
  } catch (err) {
    return handleInstagramError(env, job, err);
  }
}

async function markNeedsReview(env: Env, job: PublishJob, note: string): Promise<PublishJob | null> {
  await env.events.record(job.creator_id, job.platform, 'publish_needs_review', { job: job.id });
  return env.jobs.update(job.creator_id, job.id, { status: 'needs_review', last_error: note.slice(0, 480), error_code: 'uncertain', locked_until: null, next_attempt_at: null });
}

async function handleInstagramError(env: Env, job: PublishJob, err: unknown): Promise<RunResult> {
  if (err instanceof NotConnectedError) return { outcome: 'failed', job: await failJob(env, job, new Error('Instagram is not connected. Connect it from Connections, then retry.'), 'not_connected') };
  if (err instanceof ReauthRequiredError) return { outcome: 'failed', job: await failJob(env, job, new Error('Instagram needs to be reconnected. Reconnect it from Connections, then retry.'), 'reauth') };
  if (err instanceof JobStateError) return { outcome: 'skipped', job, note: err.message };
  if (err instanceof IntegrationError) {
    if (err.kind === 'auth') await env.conns.update(job.creator_id, 'instagram', { status: 'needs_reauth', lastError: err.userMessage.slice(0, 480) });
    if (err.retryable || err.kind === 'quota') {
      const attempts = job.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return { outcome: 'failed', job: await failJob(env, job, err, err.kind, { attempts }) };
      const base = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
      const delay = err.kind === 'rate_limit' || err.kind === 'quota' ? Math.max(base, err.retryAfterMs ?? 0, 15 * 60_000) : Math.max(base, err.retryAfterMs ?? 0);
      return reschedule(env, job, delay, err.userMessage, { attempts });
    }
    return { outcome: 'failed', job: await failJob(env, job, err, err.kind) };
  }
  console.error('[publish] unexpected error', err instanceof Error ? err.name : typeof err);
  return { outcome: 'failed', job: await failJob(env, job, new Error('Something went wrong on the server. Nothing was published.'), 'internal') };
}

/** Cron entry point: runs the due Instagram jobs, oldest first, within a total time budget. */
export async function runDueInstagramJobs(env: Env, args: { limit?: number; budgetMs?: number } = {}): Promise<{ ran: number; results: Record<RunOutcome, number> }> {
  const started = env.deps.now().getTime();
  const budget = args.budgetMs ?? 45_000;
  const due = await env.jobs.listDueInstagram(env.deps.now(), args.limit ?? 5);
  const results: Record<RunOutcome, number> = { skipped: 0, published: 0, processing: 0, rescheduled: 0, failed: 0, needs_review: 0 };
  let ran = 0;
  for (const item of due) {
    const left = budget - (env.deps.now().getTime() - started);
    if (left < 8_000) break;
    const result = await runInstagramJob(env, item.creator_id, item.id, { pollBudgetMs: Math.min(left - 4_000, 30_000) });
    results[result.outcome] += 1;
    ran += 1;
  }
  return { ran, results };
}

/**
 * Cron sweeper for jobs interrupted mid-flight. An Instagram job stuck in "uploading" had a publish
 * call in flight, so it is parked for review (never retried). A YouTube job whose upload session was
 * abandoned for a day is failed so the creator can start it again.
 */
export async function sweepStuckJobs(env: Env, olderThanMs = 24 * 3_600_000): Promise<{ parked: number; failed: number }> {
  const stuck = await env.jobs.listStuck(env.deps.now(), olderThanMs);
  let parked = 0;
  let failed = 0;
  for (const job of stuck) {
    if (job.platform === 'instagram' && job.status === 'uploading') {
      await markNeedsReview(env, job, 'Publishing was interrupted and the result was not recorded. Check Instagram before trying again.');
      parked += 1;
    } else if (job.platform === 'youtube' && job.status === 'uploading') {
      await failJob(env, job, new Error('The upload was not finished and has expired. Start it again.'), 'upload_expired', { upload_session_uri: null });
      failed += 1;
    }
  }
  return { parked, failed };
}

/** Statuses a creator may cancel through the server. In-flight publish calls cannot be cancelled. */
export const CANCELLABLE: JobStatus[] = ['draft', 'scheduled', 'processing', 'failed'];

