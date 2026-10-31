'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { loadIntegrations } from '@/lib/integrations/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { runInstagramJob } from '@/lib/integrations/publish';
import type { MediaAssetRow, PublishJob } from '@/lib/integrations/types';
import { validateJob, type JobInput } from '@/lib/integrations/validate';
import { ALLOWED_UPLOAD_MIME, EXTENSION, MEDIA_MAX_BYTES, sniffMedia } from '@/lib/media-sniff';
import { describeApproval, parseComposer } from '@/lib/publish-form';
import { rateLimit } from '@/lib/server/rate-limit';
import type { ActionResult } from '@/lib/types';


const touch = () => ['/publish', '/dashboard', '/analytics', '/library'].forEach((p) => revalidatePath(p));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_READY = 'Publishing is not set up on this deployment yet. See the Connections page.';
const STORAGE_NOT_READY = 'File storage is not set up on this deployment yet (SUPABASE_SERVICE_ROLE_KEY is missing).';

/** Saves one draft per chosen destination. Nothing is sent to any platform and nothing is approved. */
export async function saveDrafts(formData: FormData): Promise<ActionResult<{ batchId: string }>> {
  return withCreator<{ batchId: string }>(async ({ supabase, profile }) => {
    const parsed = parseComposer(formData);
    if (!parsed.ok) return fail(Object.values(parsed.errors)[0], parsed.errors);
    const v = parsed.value;

    const media = v.mediaIds.length ? await supabase.from('media_assets').select('*').eq('creator_id', profile.id).in('id', v.mediaIds) : { data: [], error: null };
    if (media.error) return dbFail('saveDrafts.media', media.error);
    const mediaRows = (media.data ?? []) as MediaAssetRow[];

    const batchId = randomUUID();
    const rows = [];
    const now = new Date();
    for (const d of v.destinations) {
      const input: JobInput = { platform: d.platform, format: d.format, title: v.title, caption: v.caption, tags: v.tags, privacy: v.privacy, madeForKids: v.madeForKids, scheduledFor: v.scheduledFor, mediaAssetIds: d.platform === 'youtube' ? [] : v.mediaIds, ideaId: v.ideaId };
      const checked = validateJob(input, mediaRows, now, 'draft');
      if (!checked.ok) return fail(Object.values(checked.errors)[0], checked.errors);
      const j = checked.value;
      rows.push({
        creator_id: profile.id, batch_id: batchId, platform: j.platform, format: j.format, title: j.title, caption: j.caption, tags: j.tags, privacy: j.privacy,
        made_for_kids: j.madeForKids, scheduled_for: j.scheduledFor, media_asset_ids: j.mediaAssetIds, idea_id: j.ideaId, status: 'draft' as const, approved_at: null,
      });
    }
    const { error } = await supabase.from('publish_jobs').insert(rows);
    if (error) return dbFail('saveDrafts', error);
    touch();
    return { ok: true, message: rows.length > 1 ? `${rows.length} drafts saved. Review and approve each one below.` : 'Draft saved. Review it below, then approve it when you are ready.', data: { batchId } };
  });
}

/**
 * The creator's explicit approval. This is the ONLY place a job leaves "draft". The database also refuses
 * any non-draft job without approved_at, and the publishing engine refuses jobs that were not approved.
 */
export async function approveJob(jobId: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(jobId)) return fail('That post was not found.');
    if (!rateLimit(`approve:${profile.id}`, 30, 60_000).allowed) return fail('Too many approvals in a minute. Wait a moment.');

    const found = await supabase.from('publish_jobs').select('*').eq('id', jobId).eq('creator_id', profile.id).maybeSingle();
    if (found.error) return dbFail('approveJob.load', found.error);
    const job = found.data as PublishJob | null;
    if (!job) return fail('That post was not found.');
    if (job.status !== 'draft') return fail('Only a draft can be approved.');

    const media = job.media_asset_ids.length ? await supabase.from('media_assets').select('*').eq('creator_id', profile.id).in('id', job.media_asset_ids) : { data: [], error: null };
    if (media.error) return dbFail('approveJob.media', media.error);
    const checked = validateJob({
      platform: job.platform, format: job.format, title: job.title, caption: job.caption, tags: job.tags, privacy: job.privacy, madeForKids: job.made_for_kids,
      scheduledFor: job.scheduled_for, mediaAssetIds: job.media_asset_ids, ideaId: job.idea_id,
    }, (media.data ?? []) as MediaAssetRow[], new Date(), 'approve');
    if (!checked.ok) return fail(Object.values(checked.errors)[0], checked.errors);

    const conn = await supabase.from('social_connections').select('status').eq('creator_id', profile.id).eq('platform', job.platform).maybeSingle();
    if (conn.error) return dbFail('approveJob.connection', conn.error);
    if (!conn.data) return fail(`${job.platform === 'youtube' ? 'YouTube' : 'Instagram'} is not connected. Connect it on the Connections page first.`);
    if ((conn.data as { status: string }).status !== 'active') return fail(`${job.platform === 'youtube' ? 'YouTube' : 'Instagram'} needs to be reconnected before this can be posted.`);

    const approvedAt = new Date().toISOString();
    const updated = await supabase.from('publish_jobs')
      .update({ status: 'scheduled', approved_at: approvedAt, scheduled_for: checked.value.scheduledFor, last_error: null, error_code: null })
      .eq('id', jobId).eq('creator_id', profile.id).eq('status', 'draft').select('id');
    if (updated.error) return dbFail('approveJob.update', updated.error);
    if (!updated.data?.length) return fail('The post changed while you were approving it. Reload and check its state.');
    touch();

    if (job.platform === 'youtube') return ok(checked.value.scheduledFor ? 'Approved. Choose the video file to upload; YouTube will publish it at the time you picked.' : 'Approved. Now choose the video file to upload.');
    const future = checked.value.scheduledFor && Date.parse(checked.value.scheduledFor) > Date.now();
    if (future) return ok(`Approved. PBOS will publish it on ${new Date(checked.value.scheduledFor as string).toUTCString()}.`);

    // Approved for "now": run it immediately instead of waiting for the next scheduled job.
    const setup = loadIntegrations();
    if (!setup.ok) return ok('Approved. Publishing is not fully set up yet, so it will go out once it is.');
    const run = await runInstagramJob(setup.env, profile.id, jobId, { pollBudgetMs: 25_000 });
    touch();
    switch (run.outcome) {
      case 'published': return ok('Published to Instagram.');
      case 'processing': return ok('Approved. Instagram is still processing the media; PBOS will publish it as soon as it is ready.');
      case 'rescheduled': return ok(`Approved, but it is waiting: ${run.note ?? 'PBOS will try again shortly.'}`);
      case 'needs_review': return fail('Instagram did not confirm whether the post went out. Check your profile, then resolve it in the list below. PBOS will not post it again on its own.');
      case 'failed': return fail(run.job?.last_error ?? 'Instagram could not publish this post.');
      default: return ok('Approved.');
    }
  });
}

export async function cancelJob(jobId: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(jobId)) return fail('That post was not found.');
    const { data, error } = await supabase.from('publish_jobs').update({ status: 'cancelled' }).eq('id', jobId).eq('creator_id', profile.id).in('status', ['draft', 'scheduled', 'processing', 'failed']).select('id');
    if (error) return dbFail('cancelJob', error);
    if (!data?.length) return fail('This post can no longer be cancelled (it may already be uploading or published).');
    touch();
    return ok('Cancelled. Nothing was posted.');
  });
}

export async function deleteJob(jobId: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(jobId)) return fail('That post was not found.');
    const { data, error } = await supabase.from('publish_jobs').delete().eq('id', jobId).eq('creator_id', profile.id).in('status', ['draft', 'cancelled', 'failed']).select('id');
    if (error) return dbFail('deleteJob', error);
    if (!data?.length) return fail('Only drafts, cancelled and failed posts can be deleted.');
    touch();
    return ok('Deleted.');
  });
}

/** Retry after a clear failure. The creator re-approves by clicking, so approved_at is refreshed. Server-side (service role) because the creator cannot write the engine's columns. */
export async function retryJob(jobId: string): Promise<ActionResult> {
  return withCreator(async ({ profile }) => {
    if (!UUID.test(jobId)) return fail('That post was not found.');
    const setup = loadIntegrations();
    if (!setup.ok) return fail(NOT_READY);
    const job = await setup.env.jobs.get(profile.id, jobId);
    if (!job || job.status !== 'failed') return fail('Only a failed post can be retried.');
    const next = await setup.env.jobs.update(profile.id, jobId, {
      status: 'scheduled', next_attempt_at: null, locked_until: null, last_error: null, error_code: null, attempts: 0, container_ids: [], upload_session_uri: null, upload_offset: 0, progress: 0,
    }, ['failed']);
    if (!next) return fail('The post changed. Reload and check its state.');
    await setup.db.from('publish_jobs').update({ approved_at: new Date().toISOString() }).eq('id', jobId).eq('creator_id', profile.id);
    touch();
    return ok(job.platform === 'youtube' ? 'Ready to retry. Choose the video file again to upload.' : 'Queued again. PBOS will try to publish it shortly.');
  });
}

/**
 * A post whose result was unclear is never retried automatically. The creator checks the platform and tells
 * PBOS what they found. "Posted" records the creator's own statement; "Not posted" makes it eligible again
 * (with a fresh container, since the old one may have been consumed).
 */
export async function resolveReview(jobId: string, outcome: 'posted' | 'not_posted'): Promise<ActionResult> {
  return withCreator(async ({ profile }) => {
    if (!UUID.test(jobId) || (outcome !== 'posted' && outcome !== 'not_posted')) return fail('That post was not found.');
    const setup = loadIntegrations();
    if (!setup.ok) return fail(NOT_READY);
    const job = await setup.env.jobs.get(profile.id, jobId);
    if (!job || job.status !== 'needs_review') return fail('This post is not waiting for your review.');
    const now = new Date().toISOString();
    const patch = outcome === 'posted'
      ? { status: 'published' as const, published_at: now, last_error: 'You confirmed this post is live. PBOS could not verify the link.', error_code: 'confirmed_by_creator', progress: 100, locked_until: null }
      : { status: 'scheduled' as const, last_error: null, error_code: null, container_ids: [], attempts: 0, next_attempt_at: null, locked_until: null, progress: 0 };
    const next = await setup.env.jobs.update(profile.id, jobId, patch, ['needs_review']);
    if (!next) return fail('The post changed. Reload and check its state.');
    touch();
    return ok(outcome === 'posted' ? 'Recorded as posted.' : 'Queued again. PBOS will publish it once, and will not retry it automatically if the result is unclear again.');
  });
}

// ── media uploads: the browser sends the bytes straight to private storage through a one-time signed URL ──

/** Step 1: validate what the creator says they are uploading and hand out a single-use upload URL in their own folder. */
export async function requestMediaUpload(input: { mime: string; bytes: number }): Promise<ActionResult<{ uploadUrl: string; path: string }>> {
  return withCreator<{ uploadUrl: string; path: string }>(async ({ user }) => {
    if (!(ALLOWED_UPLOAD_MIME as readonly string[]).includes(input.mime)) return fail('Use JPEG, PNG or WebP images, or MP4 or MOV video.');
    if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0) return fail('The file is empty.');
    if (input.bytes > MEDIA_MAX_BYTES) return fail(`Files can be up to ${Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB.`);
    if (!rateLimit(`media-url:${user.id}`, 40, 60_000).allowed) return fail('Too many uploads in a minute. Wait a moment.');
    const db = createAdminClient();
    if (!db) return fail(STORAGE_NOT_READY);
    const path = `${user.id}/${randomUUID()}.${EXTENSION[input.mime as keyof typeof EXTENSION]}`;
    const signed = await db.storage.from('creator-media').createSignedUploadUrl(path);
    if (signed.error || !signed.data?.signedUrl) return fail('Could not prepare the upload. Try again.');
    return { ok: true, data: { uploadUrl: signed.data.signedUrl, path } };
  });
}

/** Step 2: after the upload, check the stored bytes really are what was claimed, then add it to the library. */
export async function registerMedia(input: { path: string; label?: string; width?: number; height?: number; duration?: number }): Promise<ActionResult<{ id: string }>> {
  return withCreator<{ id: string }>(async ({ supabase, profile, user }) => {
    if (typeof input.path !== 'string' || !input.path.startsWith(`${user.id}/`) || input.path.includes('..') || input.path.split('/').length !== 2) return fail('That file is not yours.');
    const db = createAdminClient();
    if (!db) return fail(STORAGE_NOT_READY);
    const bucket = db.storage.from('creator-media');

    const name = input.path.split('/')[1];
    const listed = await bucket.list(user.id, { search: name, limit: 5 });
    const object = listed.data?.find((o: { name: string }) => o.name === name) as { metadata?: { size?: number; mimetype?: string } } | undefined;
    if (!object) return fail('The upload did not finish. Try again.');
    const size = Number(object.metadata?.size ?? 0);
    if (size <= 0 || size > MEDIA_MAX_BYTES) { await bucket.remove([input.path]); return fail('That file is empty or too large.'); }

    // Check the real bytes (first 32), not the file name or the browser's Content-Type.
    const signed = await bucket.createSignedUrl(input.path, 60);
    let head: Uint8Array | null = null;
    if (signed.data?.signedUrl) {
      const res = await fetch(signed.data.signedUrl, { headers: { Range: 'bytes=0-31' } }).catch(() => null);
      if (res && (res.status === 200 || res.status === 206)) head = new Uint8Array((await res.arrayBuffer()).slice(0, 32));
    }
    const sniffed = head ? sniffMedia(head) : null;
    if (!sniffed) { await bucket.remove([input.path]); return fail('That file does not look like a supported image or video, so it was removed.'); }

    const row = await supabase.from('media_assets').insert({
      creator_id: profile.id, kind: sniffed.kind, source: 'upload', storage_path: input.path, mime_type: sniffed.mime, bytes: size,
      width: Number.isInteger(input.width) && (input.width as number) > 0 ? input.width : null, height: Number.isInteger(input.height) && (input.height as number) > 0 ? input.height : null,
      duration_s: sniffed.kind === 'video' && typeof input.duration === 'number' && Number.isFinite(input.duration) && input.duration > 0 && input.duration <= 36_000 ? Math.round(input.duration * 100) / 100 : null,
      label: typeof input.label === 'string' ? input.label.slice(0, 200) : null, ai_generated: false,
    }).select('id').single();
    if (row.error) { await bucket.remove([input.path]); return dbFail('registerMedia', row.error); }
    touch();
    return { ok: true, message: 'Added to your library.', data: { id: (row.data as { id: string }).id } };
  });
}

/** Removes a library file and its row, unless a post that has not finished still needs it. */
export async function deleteMedia(mediaId: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(mediaId)) return fail('That file was not found.');
    const media = await supabase.from('media_assets').select('id, bucket, storage_path').eq('id', mediaId).eq('creator_id', profile.id).maybeSingle();
    if (media.error) return dbFail('deleteMedia.load', media.error);
    if (!media.data) return fail('That file was not found.');
    const inUse = await supabase.from('publish_jobs').select('id').eq('creator_id', profile.id).contains('media_asset_ids', [mediaId]).in('status', ['draft', 'scheduled', 'uploading', 'processing']).limit(1);
    if (inUse.error) return dbFail('deleteMedia.inuse', inUse.error);
    if (inUse.data?.length) return fail('A post that has not finished still uses this file. Cancel or delete that post first.');
    const db = createAdminClient();
    if (!db) return fail(STORAGE_NOT_READY);
    const row = media.data as { bucket: string; storage_path: string };
    await db.storage.from(row.bucket).remove([row.storage_path]);
    const del = await supabase.from('media_assets').delete().eq('id', mediaId).eq('creator_id', profile.id);
    if (del.error) return dbFail('deleteMedia', del.error);
    touch();
    return ok('Deleted.');
  });
}
