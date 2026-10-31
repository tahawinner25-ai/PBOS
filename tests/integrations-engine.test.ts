import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { dedupePoints, instagramFormat, syncInstagram, syncYouTube, youtubeDailyPoints, youtubeFormat } from '../src/lib/integrations/analytics-sync';
import { NotConnectedError, ReauthRequiredError, getInstagramCreds, getYouTubeToken, refreshConnection } from '../src/lib/integrations/connections';
import { IntegrationError } from '../src/lib/integrations/errors';
import {
  JobStateError, OffsetMismatchError, UPLOAD_CHUNK_BYTES, beginYouTubeUpload, pushYouTubeChunk, runDueInstagramJobs, runInstagramJob, sweepStuckJobs,
} from '../src/lib/integrations/publish';
import { DEFAULT_QUOTA, nextPacificMidnight, pacificDay, quotaConfigFromEnv, reserveYoutube } from '../src/lib/integrations/quota';
import { normalizeTags, validateJob, youtubeTagsLength, type JobInput } from '../src/lib/integrations/validate';
import { CREATOR, SECRET_TOKEN, START, bare, form, json, makeEnv, makeJob } from './integration-fakes';

const NOW = new Date(START);
const iso = (ms: number) => new Date(ms).toISOString();
const SESSION = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc';

/* ───────────────────────────── validate ───────────────────────────── */

describe('validateJob', () => {
  const jpg = { id: 'a', kind: 'image' as const, mime_type: 'image/jpeg', ai_generated: false };
  const media = (over: Record<string, unknown> = {}) => ({ creator_id: CREATOR, source: 'upload' as const, bucket: 'b', storage_path: 'p', bytes: 1, width: null, height: null, duration_s: null, label: null, ...jpg, ...over });
  const yt = (over: Partial<JobInput> = {}): JobInput => ({ platform: 'youtube', format: 'video', title: 'A title', caption: 'About', madeForKids: false, ...over });
  const ig = (over: Partial<JobInput> = {}): JobInput => ({ platform: 'instagram', format: 'photo', caption: 'Hi', mediaAssetIds: ['a'], ...over });
  const errors = (r: ReturnType<typeof validateJob>) => (r.ok ? {} : r.errors);

  it('YouTube: a draft may be incomplete, approval may not', () => {
    assert.equal(validateJob(yt({ title: '', madeForKids: null }), [], NOW, 'draft').ok, true);
    const e = errors(validateJob(yt({ title: '', madeForKids: null }), [], NOW, 'approve'));
    assert.ok(e.title && e.madeForKids);
  });
  it('YouTube: limits, angle brackets and privacy default (private unless chosen)', () => {
    assert.ok(errors(validateJob(yt({ title: 'x'.repeat(101) }), [], NOW, 'draft')).title);
    assert.ok(errors(validateJob(yt({ title: 'a <b> c' }), [], NOW, 'draft')).title);
    assert.ok(errors(validateJob(yt({ caption: 'é'.repeat(2600) }), [], NOW, 'draft')).caption, 'description limit counts bytes, not characters');
    assert.ok(errors(validateJob(yt({ tags: ['a>b'] }), [], NOW, 'draft')).tags);
    assert.ok(errors(validateJob(yt({ tags: Array.from({ length: 80 }, (_, i) => `tag-number-${i}`) }), [], NOW, 'draft')).tags);
    const ok = validateJob(yt(), [], NOW, 'approve');
    assert.ok(ok.ok && ok.value.privacy === 'private');
    assert.ok(errors(validateJob(yt({ privacy: 'secret' as never }), [], NOW, 'draft')).privacy);
  });
  it('YouTube: files are uploaded from the browser, not attached from the library', () => {
    assert.ok(errors(validateJob(yt({ mediaAssetIds: ['a'] }), [media()], NOW, 'draft')).media);
  });
  it('scheduling window: at least 5 minutes ahead, at most 180 days, valid dates only', () => {
    const at = (ms: number) => iso(START + ms);
    assert.ok(errors(validateJob(yt({ scheduledFor: at(60_000) }), [], NOW, 'draft')).scheduledFor);
    assert.ok(errors(validateJob(yt({ scheduledFor: 'tomorrow-ish' }), [], NOW, 'draft')).scheduledFor);
    assert.ok(errors(validateJob(yt({ scheduledFor: at(200 * 86_400_000) }), [], NOW, 'draft')).scheduledFor);
    const ok = validateJob(yt({ scheduledFor: at(3_600_000) }), [], NOW, 'approve');
    assert.ok(ok.ok && ok.value.scheduledFor === at(3_600_000));
  });
  it('Instagram: a photo outside 4:5 to 1.91:1 is refused, an unknown size is left to Instagram', () => {
    const tall = validateJob(ig(), [media({ width: 1024, height: 1536 })] as never, NOW, 'approve');
    assert.match(errors(tall).media ?? '', /4:5/);
    assert.equal(validateJob(ig(), [media({ width: 1024, height: 1280 })] as never, NOW, 'approve').ok, true);
    assert.equal(validateJob(ig(), [media({ width: 1536, height: 1024 })] as never, NOW, 'approve').ok, true);
    assert.equal(validateJob(ig(), [media({ width: 4000, height: 1000 })] as never, NOW, 'approve').ok, false);
    assert.equal(validateJob(ig(), [media()] as never, NOW, 'approve').ok, true);
    const car = validateJob(ig({ format: 'carousel', mediaAssetIds: ['a', 'b'] }), [media({ width: 1024, height: 1024 }), media({ id: 'b', width: 500, height: 1500 })] as never, NOW, 'approve');
    assert.match(errors(car).media ?? '', /4:5/);
  });

  it('Instagram: photo must be exactly one JPEG', () => {
    assert.equal(validateJob(ig(), [media()], NOW, 'approve').ok, true);
    assert.ok(errors(validateJob(ig(), [media({ mime_type: 'image/png' })], NOW, 'approve')).media);
    assert.ok(errors(validateJob(ig({ mediaAssetIds: [] }), [], NOW, 'approve')).media);
    assert.ok(errors(validateJob(ig({ mediaAssetIds: ['a', 'b'] }), [media(), media({ id: 'b' })], NOW, 'approve')).media);
    assert.ok(errors(validateJob(ig({ mediaAssetIds: ['gone'] }), [], NOW, 'draft')).media, 'a deleted file is reported');
    assert.equal(validateJob(ig({ mediaAssetIds: [] }), [], NOW, 'draft').ok, true, 'drafts can be saved before the media is chosen');
  });
  it('Instagram: reels and carousels', () => {
    const video = media({ id: 'v', kind: 'video', mime_type: 'video/mp4' });
    assert.equal(validateJob(ig({ format: 'reel', mediaAssetIds: ['v'] }), [video], NOW, 'approve').ok, true);
    assert.ok(errors(validateJob(ig({ format: 'reel', mediaAssetIds: ['v'] }), [media({ id: 'v', kind: 'video', mime_type: 'video/webm' })], NOW, 'approve')).media);
    const items = (n: number) => Array.from({ length: n }, (_, i) => media({ id: `i${i}` }));
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `i${i}`);
    assert.ok(errors(validateJob(ig({ format: 'carousel', mediaAssetIds: ids(1) }), items(1), NOW, 'approve')).media);
    assert.equal(validateJob(ig({ format: 'carousel', mediaAssetIds: ids(10) }), items(10), NOW, 'approve').ok, true);
    assert.ok(errors(validateJob(ig({ format: 'carousel', mediaAssetIds: ids(11) }), items(11), NOW, 'approve')).media);
    assert.ok(errors(validateJob(ig({ format: 'carousel', mediaAssetIds: ['i0', 'p'] }), [media({ id: 'i0' }), media({ id: 'p', mime_type: 'image/png' })], NOW, 'approve')).media);
  });
  it('Instagram: caption limits, forced public privacy, AI flag, unsupported format', () => {
    assert.ok(errors(validateJob(ig({ caption: 'x'.repeat(2201) }), [media()], NOW, 'draft')).caption);
    assert.ok(errors(validateJob(ig({ caption: Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ') }), [media()], NOW, 'draft')).caption);
    const r = validateJob(ig({ privacy: 'private' }), [media({ ai_generated: true })], NOW, 'approve');
    assert.ok(r.ok && r.value.privacy === 'public' && r.value.containsAi === true);
    assert.ok(errors(validateJob(ig({ format: 'video' }), [media()], NOW, 'draft')).format);
    const t = validateJob(ig({ title: 'x' }), [media()], NOW, 'approve');
    assert.ok(t.ok && t.warnings.length === 1);
  });
  it('tag helpers', () => {
    assert.deepEqual(normalizeTags(['#One', 'one', ' two  words ', '', '##three']), ['One', 'two words', 'three']);
    assert.equal(youtubeTagsLength(['ab', 'c d']), 2 + 5 + 1);
  });
});

/* ───────────────────────────── quota ───────────────────────────── */

describe('quota', () => {
  it('Pacific day rolls over at midnight Pacific, on both sides of the DST change', () => {
    assert.equal(pacificDay(new Date('2026-10-20T06:59:00Z')), '2026-10-19');
    assert.equal(pacificDay(new Date('2026-10-20T07:00:00Z')), '2026-10-20');
    assert.equal(pacificDay(new Date('2026-11-02T07:59:00Z')), '2026-11-01');
    assert.equal(pacificDay(new Date('2026-11-02T08:00:00Z')), '2026-11-02');
    const within = (a: Date, b: string) => assert.ok(Math.abs(a.getTime() - Date.parse(b)) <= 1000, `${a.toISOString()} vs ${b}`);
    within(nextPacificMidnight(new Date('2026-10-20T12:00:00Z')), '2026-10-21T07:00:00Z');
    within(nextPacificMidnight(new Date('2026-11-01T12:00:00Z')), '2026-11-02T08:00:00Z');
    within(nextPacificMidnight(new Date('2026-10-31T20:00:00Z')), '2026-11-01T07:00:00Z');
  });
  it('reservations stop at the limit without spending, and buckets are independent', async () => {
    const { quota } = makeEnv();
    const base = { creatorId: CREATOR, config: { defaultUnits: 10, uploadCalls: 2 }, now: NOW };
    assert.equal((await reserveYoutube(quota, { ...base, bucket: 'default', units: 6 })).ok, true);
    const refused = await reserveYoutube(quota, { ...base, bucket: 'default', units: 5 });
    assert.equal(refused.ok, false);
    assert.equal(refused.used, 6, 'a refused reservation spends nothing');
    assert.equal((await reserveYoutube(quota, { ...base, bucket: 'default', units: 4 })).ok, true);
    assert.equal((await reserveYoutube(quota, { ...base, bucket: 'uploads', units: 1 })).ok, true);
    assert.equal((await reserveYoutube(quota, { ...base, bucket: 'uploads', units: 1 })).ok, true);
    assert.equal((await reserveYoutube(quota, { ...base, bucket: 'uploads', units: 1 })).ok, false);
    const tomorrow = { ...base, bucket: 'uploads' as const, units: 1, now: new Date(START + 86_400_000) };
    assert.equal((await reserveYoutube(quota, tomorrow)).ok, true, 'a new Pacific day starts a new allowance');
  });
  it('environment overrides ignore junk values', () => {
    assert.deepEqual(quotaConfigFromEnv({}), DEFAULT_QUOTA);
    assert.deepEqual(quotaConfigFromEnv({ YOUTUBE_QUOTA_DAILY_UNITS: '20000', YOUTUBE_UPLOAD_DAILY_LIMIT: '6' }), { defaultUnits: 20000, uploadCalls: 6 });
    assert.deepEqual(quotaConfigFromEnv({ YOUTUBE_QUOTA_DAILY_UNITS: '-5', YOUTUBE_UPLOAD_DAILY_LIMIT: 'lots' }), DEFAULT_QUOTA);
  });
});

/* ──────────────────────────── connections ──────────────────────────── */

describe('token freshness', () => {
  const youtubeArgs = (t: ReturnType<typeof makeEnv>) => ({ deps: t.deps, conns: t.conns, events: t.events, google: t.env.google!, creatorId: CREATOR });
  const instagramArgs = (t: ReturnType<typeof makeEnv>) => ({ deps: t.deps, conns: t.conns, events: t.events, meta: t.env.meta!, creatorId: CREATOR });

  it('Google: a fresh token is used as is, with no network call', async () => {
    const t = makeEnv();
    t.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
    assert.equal((await getYouTubeToken(youtubeArgs(t))).token, 'AT');
    assert.equal(t.net.calls.length, 0);
  });
  it('Google: a token near expiry is refreshed and stored', async () => {
    const t = makeEnv();
    t.net.route('POST /token', () => json({ access_token: 'NEW', expires_in: 3600 }));
    t.conns.put({ platform: 'youtube', accessToken: 'OLD', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 30_000) });
    assert.equal((await getYouTubeToken(youtubeArgs(t))).token, 'NEW');
    const row = await t.conns.get(CREATOR, 'youtube');
    assert.equal(row?.accessToken, 'NEW');
    assert.equal(row?.refreshToken, 'RT');
  });
  it('Google: a revoked grant marks the connection for reconnect and says why, once', async () => {
    const t = makeEnv();
    t.net.route('POST /token', () => json({ error: 'invalid_grant' }, 400));
    t.conns.put({ platform: 'youtube', accessToken: null, refreshToken: 'RT' });
    await assert.rejects(getYouTubeToken(youtubeArgs(t)), ReauthRequiredError);
    assert.equal((await t.conns.get(CREATOR, 'youtube'))?.status, 'needs_reauth');
    assert.deepEqual(t.events.types(), ['token_refresh_failed']);
    assert.equal(t.net.calls.length, 1);
    await assert.rejects(getYouTubeToken(youtubeArgs(t)), ReauthRequiredError, 'a connection needing reauth is not retried');
    assert.equal(t.net.calls.length, 1);
  });
  it('Google: not connected, and a missing refresh token', async () => {
    const t = makeEnv();
    await assert.rejects(getYouTubeToken(youtubeArgs(t)), NotConnectedError);
    t.conns.put({ platform: 'youtube', accessToken: null, refreshToken: null });
    await assert.rejects(getYouTubeToken(youtubeArgs(t)), ReauthRequiredError);
  });
  it('Instagram: a long-lived token is renewed inside the 14-day window and left alone before it', async () => {
    const far = makeEnv();
    far.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START + 40 * 86_400_000) });
    assert.equal((await getInstagramCreds(instagramArgs(far))).pageToken, 'P');
    assert.equal(far.net.calls.length, 0);

    const near = makeEnv();
    near.net.route('POST /oauth/access_token', () => json({ access_token: 'U2', expires_in: 5_184_000 }));
    near.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START + 5 * 86_400_000) });
    await getInstagramCreds(instagramArgs(near));
    assert.equal((await near.conns.get(CREATOR, 'instagram'))?.accessToken, 'U2');
  });
  it('Instagram: a failed renewal is tolerated while the token is still valid, fatal once it has lapsed', async () => {
    const valid = makeEnv();
    valid.net.route('POST /oauth/access_token', () => json({ error: { code: 190 } }, 400));
    valid.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START + 86_400_000) });
    assert.equal((await getInstagramCreds(instagramArgs(valid))).pageToken, 'P');
    assert.equal((await valid.conns.get(CREATOR, 'instagram'))?.status, 'active');

    const lapsed = makeEnv();
    lapsed.net.route('POST /oauth/access_token', () => json({ error: { code: 190 } }, 400));
    lapsed.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START - 1000) });
    await assert.rejects(getInstagramCreds(instagramArgs(lapsed)), ReauthRequiredError);
    assert.equal((await lapsed.conns.get(CREATOR, 'instagram'))?.status, 'needs_reauth');
  });
  it('refresh job reports what happened without throwing', async () => {
    const t = makeEnv();
    const base = { deps: t.deps, conns: t.conns, events: t.events, creatorId: CREATOR, google: t.env.google, meta: t.env.meta };
    assert.equal(await refreshConnection({ ...base, platform: 'youtube' }), 'skipped');
    t.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
    assert.equal(await refreshConnection({ ...base, platform: 'youtube' }), 'skipped', 'plenty of time left');
    t.net.route('POST /token', () => json({ access_token: 'N', expires_in: 3600 }));
    t.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 60_000) });
    assert.equal(await refreshConnection({ ...base, platform: 'youtube' }), 'refreshed');
    assert.equal(await refreshConnection({ ...base, platform: 'youtube', google: null }), 'skipped');
  });
});

/* ───────────────────────── YouTube publishing ───────────────────────── */

describe('YouTube publishing', () => {
  let t: ReturnType<typeof makeEnv>;
  const file = { size: UPLOAD_CHUNK_BYTES * 3, mime: 'video/mp4' };
  const ytJob = (over = {}) => makeJob({ platform: 'youtube', format: 'video', title: 'My video', caption: 'About it', privacy: 'public', made_for_kids: false, media_asset_ids: [], status: 'scheduled', ...over });
  const sessionRoute = () => t.net.route('POST /upload/youtube/v3/videos', () => bare(200, { location: SESSION }));

  beforeEach(() => {
    t = makeEnv();
    t.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
  });

  it('refuses to upload anything the creator has not approved', async () => {
    t.jobs.add(ytJob({ approved_at: null, status: 'draft' }));
    await assert.rejects(beginYouTubeUpload(t.env, CREATOR, 'job-1', file), (e) => e instanceof JobStateError && /Approve/.test(e.message));
    t.jobs.add(ytJob({ approved_at: null }));
    await assert.rejects(beginYouTubeUpload(t.env, CREATOR, 'job-1', file), JobStateError);
    assert.equal(t.net.calls.length, 0);
  });
  it('rejects bad files and other creators\' jobs before any network call', async () => {
    t.jobs.add(ytJob());
    await assert.rejects(beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 0, mime: 'video/mp4' }), JobStateError);
    await assert.rejects(beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 10, mime: 'application/pdf' }), JobStateError);
    await assert.rejects(beginYouTubeUpload(t.env, 'someone-else', 'job-1', file), JobStateError);
    assert.equal(t.net.calls.length, 0);
  });
  it('begins an upload with the job\'s own metadata and records the session', async () => {
    sessionRoute();
    t.jobs.add(ytJob({ scheduled_for: iso(START + 3 * 3_600_000), tags: ['one'] }));
    const start = await beginYouTubeUpload(t.env, CREATOR, 'job-1', file);
    assert.deepEqual(start, { offset: 0, chunkSize: UPLOAD_CHUNK_BYTES, resumed: false });
    const sent = JSON.parse(String(t.net.calls[0].body));
    assert.equal(sent.snippet.title, 'My video');
    assert.equal(sent.status.privacyStatus, 'private', 'scheduled videos are uploaded private and released by publishAt');
    assert.equal(sent.status.publishAt, iso(START + 3 * 3_600_000));
    assert.equal(sent.status.selfDeclaredMadeForKids, false);
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.status, 'uploading');
    assert.equal(job?.upload_session_uri, SESSION);
    assert.equal(job?.attempts, 1);
    assert.equal(await t.quota.used(CREATOR, 'youtube', 'uploads', pacificDay(NOW)), 1);
  });
  it('stops when the day\'s upload allowance is used, and says when it resets', async () => {
    t.jobs.add(ytJob());
    await t.quota.bump(CREATOR, 'youtube', 'uploads', pacificDay(NOW), DEFAULT_QUOTA.uploadCalls);
    await assert.rejects(beginYouTubeUpload(t.env, CREATOR, 'job-1', file), (e) => e instanceof IntegrationError && e.kind === 'quota' && /resets/.test(e.userMessage));
    assert.equal(t.net.calls.length, 0);
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.status, 'scheduled', 'the job is left intact so it can be retried tomorrow');
  });
  it('chunks must arrive in order; progress is tracked; a wrong offset is refused without touching Google', async () => {
    sessionRoute();
    t.net.route('PUT /upload', () => bare(308, { range: `bytes=0-${UPLOAD_CHUNK_BYTES - 1}` }));
    t.jobs.add(ytJob());
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', file);
    const chunk = new Uint8Array(UPLOAD_CHUNK_BYTES);
    await assert.rejects(pushYouTubeChunk(t.env, CREATOR, 'job-1', UPLOAD_CHUNK_BYTES, chunk), (e) => e instanceof OffsetMismatchError && e.expected === 0);
    assert.equal(t.net.count('/upload', 'PUT'), 0);
    const r = await pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, chunk);
    assert.deepEqual(r, { done: false, nextOffset: UPLOAD_CHUNK_BYTES, progress: 33 });
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.upload_offset, UPLOAD_CHUNK_BYTES);
    const call = t.net.calls.find((c) => c.method === 'PUT')!;
    assert.equal(call.headers.authorization, undefined);
  });
  it('the last chunk publishes: the post is recorded, the idea is marked posted, the session address is cleared', async () => {
    sessionRoute();
    t.net.route('PUT /upload', () => json({ id: 'vid9', status: { privacyStatus: 'public' } }));
    t.jobs.add(ytJob({ idea_id: 'idea-1' }));
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    const r = await pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024));
    assert.ok(r.done);
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.status, 'published');
    assert.equal(job?.external_id, 'vid9');
    assert.equal(job?.external_url, 'https://www.youtube.com/watch?v=vid9');
    assert.equal(job?.upload_session_uri, null);
    assert.equal(job?.error_code, null);
    assert.equal(t.posts.posts[0].external_id, 'vid9');
    assert.equal(t.posts.posts[0].format, 'Long video');
    assert.deepEqual(t.posts.postedIdeas, ['idea-1']);
  });
  it('Shorts get a Shorts URL; scheduled videos become platform_scheduled', async () => {
    sessionRoute();
    t.net.route('PUT /upload', () => json({ id: 'sh1', status: { privacyStatus: 'private' } }));
    t.jobs.add(ytJob({ format: 'short', scheduled_for: iso(START + 7_200_000) }));
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    await pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024));
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.status, 'platform_scheduled');
    assert.equal(job?.external_url, 'https://www.youtube.com/shorts/sh1');
    assert.equal(job?.published_at, iso(START + 7_200_000));
    assert.equal(job?.error_code, null, 'private is expected for a scheduled video');
  });
  it('if YouTube keeps a public video private, the job says so instead of claiming it is live', async () => {
    sessionRoute();
    t.net.route('PUT /upload', () => json({ id: 'v1', status: { privacyStatus: 'private' } }));
    t.jobs.add(ytJob());
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    await pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024));
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.error_code, 'kept_private');
    assert.match(job?.last_error ?? '', /kept this video private/);
  });
  it('a permanent rejection fails the job; a transient error leaves it resumable', async () => {
    sessionRoute();
    t.net.route('PUT /upload', () => json({ error: { errors: [{ reason: 'invalidMetadata' }], code: 400, message: 'bad' } }, 400), { once: true });
    t.jobs.add(ytJob());
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    await assert.rejects(pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024)), IntegrationError);
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.status, 'failed');

    const t2 = makeEnv();
    t2.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
    t2.net.route('POST /upload/youtube/v3/videos', () => bare(200, { location: SESSION })).route('PUT /upload', () => bare(503));
    t2.jobs.add(ytJob());
    await beginYouTubeUpload(t2.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    await assert.rejects(pushYouTubeChunk(t2.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024)), IntegrationError);
    assert.equal((await t2.jobs.get(CREATOR, 'job-1'))?.status, 'uploading');
  });
  it('resumes an interrupted upload of the same file from Google\'s own record of the offset', async () => {
    sessionRoute();
    t.jobs.add(ytJob({ status: 'uploading', upload_session_uri: SESSION, upload_size: file.size, upload_offset: 0, upload_mime: 'video/mp4' }));
    t.net.route('PUT /upload', () => bare(308, { range: `bytes=0-${UPLOAD_CHUNK_BYTES * 2 - 1}` }));
    const r = await beginYouTubeUpload(t.env, CREATOR, 'job-1', file);
    assert.deepEqual(r, { offset: UPLOAD_CHUNK_BYTES * 2, chunkSize: UPLOAD_CHUNK_BYTES, resumed: true });
    assert.equal(t.net.count('/upload/youtube/v3/videos', 'POST'), 0, 'no new session and no extra quota');
    assert.equal(await t.quota.used(CREATOR, 'youtube', 'uploads', pacificDay(NOW)), 0);
  });
  it('an expired session starts a fresh one', async () => {
    sessionRoute();
    t.jobs.add(ytJob({ status: 'uploading', upload_session_uri: SESSION, upload_size: file.size, upload_offset: UPLOAD_CHUNK_BYTES, upload_mime: 'video/mp4' }));
    t.net.route('PUT /upload', () => json({ error: { code: 404 } }, 404));
    const r = await beginYouTubeUpload(t.env, CREATOR, 'job-1', file);
    assert.deepEqual(r, { offset: 0, chunkSize: UPLOAD_CHUNK_BYTES, resumed: false });
    assert.equal(t.net.count('/upload/youtube/v3/videos', 'POST'), 1);
  });
  it('never puts an access token or the session address in events, errors or the job row', async () => {
    t.conns.put({ platform: 'youtube', accessToken: SECRET_TOKEN, refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
    sessionRoute();
    t.net.route('PUT /upload', () => json({ id: 'vid9', status: { privacyStatus: 'public' } }));
    t.jobs.add(ytJob());
    await beginYouTubeUpload(t.env, CREATOR, 'job-1', { size: 256 * 1024, mime: 'video/mp4' });
    await pushYouTubeChunk(t.env, CREATOR, 'job-1', 0, new Uint8Array(256 * 1024));
    const dump = JSON.stringify([t.events.list, await t.jobs.get(CREATOR, 'job-1')]);
    assert.ok(!dump.includes(SECRET_TOKEN));
    assert.ok(!dump.includes('upload_id=abc'), 'the session address is cleared once the upload finishes');
    assert.ok(t.net.calls.some((c) => c.headers.authorization === `Bearer ${SECRET_TOKEN}`), 'the token was used for the session request');
  });
});

/* ──────────────────────── Instagram publishing ──────────────────────── */

describe('Instagram publishing', () => {
  let t: ReturnType<typeof makeEnv>;
  const okLimit = () => t.net.route('GET /ig_1/content_publishing_limit', () => json({ data: [{ quota_usage: 1, config: { quota_total: 100, quota_duration: 86400 } }] }));
  /** Routes for a successful single-container flow. */
  const happy = (opts: { status?: () => string } = {}) => {
    okLimit();
    t.net.route('POST /ig_1/media_publish', () => json({ id: 'media1' }))
      .route('POST /ig_1/media', () => json({ id: 'cont1' }))
      .route('GET /cont1', () => json({ status_code: opts.status ? opts.status() : 'FINISHED' }))
      .route('GET /media1', () => json({ id: 'media1', permalink: 'https://www.instagram.com/p/abc/' }));
  };

  beforeEach(() => {
    t = makeEnv();
    t.conns.put({ platform: 'instagram', accessToken: 'USERTOK', pageToken: 'PAGETOK', accessTokenExpiresAt: new Date(START + 50 * 86_400_000) });
    t.media.add({ id: 'm1' });
  });

  it('publishes a photo: signed URL to Meta, publish once, post recorded with the permalink', async () => {
    happy();
    t.jobs.add(makeJob({ idea_id: 'idea-1' }));
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'published');
    assert.equal(t.net.count('media_publish', 'POST'), 1);
    const create = t.net.calls.find((c) => c.method === 'POST' && c.url.endsWith('/ig_1/media'))!;
    const fields = form(create);
    assert.match(fields.get('image_url') ?? '', /^https:\/\/signed\.example\/user\/m1\.jpg\?ttl=3600$/);
    assert.equal(fields.get('caption'), 'Hello');
    assert.equal(fields.has('is_ai_generated'), false);
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.deepEqual([job?.status, job?.external_id, job?.external_url, job?.progress], ['published', 'media1', 'https://www.instagram.com/p/abc/', 100]);
    assert.equal(t.posts.posts[0].platform, 'Instagram');
    assert.deepEqual(t.posts.postedIdeas, ['idea-1']);
  });
  it('AI-generated media is labelled to Instagram', async () => {
    happy();
    t.media.add({ id: 'm1', ai_generated: true });
    t.jobs.add(makeJob());
    await runInstagramJob(t.env, CREATOR, 'job-1');
    const create = t.net.calls.find((c) => c.method === 'POST' && c.url.endsWith('/ig_1/media'))!;
    assert.equal(form(create).get('is_ai_generated'), 'true');
  });
  it('a job that was never approved is never touched', async () => {
    happy();
    t.jobs.add(makeJob({ approved_at: null }));
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'skipped');
    assert.equal(t.net.calls.length, 0);
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.locked_until, null, 'the lock is released');
  });
  it('a job that is not due yet waits, with no network call', async () => {
    happy();
    t.jobs.add(makeJob({ scheduled_for: iso(START + 3_600_000) }));
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.deepEqual([r.outcome, r.note], ['skipped', 'not due yet']);
    assert.equal(t.net.calls.length, 0);
  });
  it('two workers cannot run the same job at once', async () => {
    happy();
    t.jobs.add(makeJob());
    const [a, b] = await Promise.all([runInstagramJob(t.env, CREATOR, 'job-1'), runInstagramJob(t.env, CREATOR, 'job-1')]);
    assert.deepEqual([a.outcome, b.outcome].sort(), ['published', 'skipped']);
    assert.equal(t.net.count('media_publish', 'POST'), 1);
  });
  it('other creators\' jobs are invisible', async () => {
    happy();
    t.jobs.add(makeJob());
    assert.equal((await runInstagramJob(t.env, 'someone-else', 'job-1')).outcome, 'skipped');
    assert.equal(t.net.calls.length, 0);
  });
  it('Meta\'s 24-hour publishing limit defers the job without creating containers', async () => {
    t.net.route('GET /ig_1/content_publishing_limit', () => json({ data: [{ quota_usage: 100, config: { quota_total: 100, quota_duration: 86400 } }] }));
    t.jobs.add(makeJob());
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'rescheduled');
    assert.equal(t.net.count('/ig_1/media', 'POST'), 0);
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.status, 'scheduled');
    assert.equal(job?.next_attempt_at, iso(START + 30 * 60_000));
    assert.match(job?.last_error ?? '', /24-hour publishing limit/);
  });
  it('a container still processing after the polling budget is parked as processing and never published', async () => {
    happy({ status: () => 'IN_PROGRESS' });
    t.jobs.add(makeJob());
    const r = await runInstagramJob(t.env, CREATOR, 'job-1', { pollBudgetMs: 10_000 });
    assert.equal(r.outcome, 'processing');
    assert.equal(t.net.count('/media_publish', 'POST'), 0);
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.deepEqual([job?.status, job?.container_ids], ['processing', ['cont1']]);
  });
  it('the next run resumes the same container instead of creating another, then publishes', async () => {
    let state = 'IN_PROGRESS';
    happy({ status: () => state });
    t.jobs.add(makeJob());
    await runInstagramJob(t.env, CREATOR, 'job-1', { pollBudgetMs: 5_000 });
    state = 'FINISHED';
    t.deps.clock.now += 60_000;
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'published');
    assert.equal(t.net.count('/ig_1/media', 'POST') - t.net.count('media_publish', 'POST'), 1, 'exactly one container was ever created');
    assert.equal(t.net.count('media_publish', 'POST'), 1);
  });
  it('a container that errors fails the job and publishes nothing', async () => {
    happy({ status: () => 'ERROR' });
    t.jobs.add(makeJob());
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'failed');
    assert.equal(t.net.count('/media_publish', 'POST'), 0);
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.error_code, 'container_error');
  });
  it('if media_publish fails in an unclear way the job is parked for review and publish is never repeated', async () => {
    okLimit();
    t.net.route('POST /ig_1/media_publish', () => bare(503))
      .route('POST /ig_1/media', () => json({ id: 'cont1' }))
      .route('GET /cont1', () => json({ status_code: 'FINISHED' }));
    t.jobs.add(makeJob());
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'needs_review');
    assert.equal(t.net.count('media_publish', 'POST'), 1, 'one call, no retries');
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.status, 'needs_review');
    assert.match(job?.last_error ?? '', /will not retry automatically/);
    // Later runs and the cron picker leave it alone.
    assert.equal((await runInstagramJob(t.env, CREATOR, 'job-1')).outcome, 'skipped');
    t.deps.clock.now += 3_600_000;
    assert.equal((await runDueInstagramJobs(t.env)).ran, 0);
    assert.equal(t.net.count('media_publish', 'POST'), 1);
  });
  it('a definite auth failure at publish time fails the job and flags the connection', async () => {
    okLimit();
    t.net.route('POST /ig_1/media_publish', () => json({ error: { code: 190, message: 'Invalid OAuth access token.' } }, 400))
      .route('POST /ig_1/media', () => json({ id: 'cont1' }))
      .route('GET /cont1', () => json({ status_code: 'FINISHED' }));
    t.jobs.add(makeJob());
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'failed');
    assert.equal((await t.conns.get(CREATOR, 'instagram'))?.status, 'needs_reauth');
  });
  it('rate limiting while creating the container reschedules with backoff, then fails after five attempts', async () => {
    okLimit();
    t.net.route('POST /ig_1/media', () => json({ error: { code: 4, message: 'rate' } }, 429));
    t.jobs.add(makeJob());
    const first = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(first.outcome, 'rescheduled');
    const job = await t.jobs.get(CREATOR, 'job-1');
    assert.equal(job?.attempts, 1);
    assert.ok(Date.parse(job!.next_attempt_at!) - t.deps.clock.now >= 15 * 60_000);
    await t.jobs.update(CREATOR, 'job-1', { attempts: 4, next_attempt_at: null });
    const last = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(last.outcome, 'failed');
  });
  it('a missing file, a missing connection and a connection needing reauth fail clearly', async () => {
    happy();
    t.jobs.add(makeJob({ media_asset_ids: ['gone'] }));
    assert.equal((await runInstagramJob(t.env, CREATOR, 'job-1')).outcome, 'failed');
    assert.equal((await t.jobs.get(CREATOR, 'job-1'))?.error_code, 'media_missing');

    const t2 = makeEnv();
    t2.media.add({ id: 'm1' });
    t2.jobs.add(makeJob());
    assert.equal((await runInstagramJob(t2.env, CREATOR, 'job-1')).outcome, 'failed');
    assert.equal((await t2.jobs.get(CREATOR, 'job-1'))?.error_code, 'not_connected');

    const t3 = makeEnv();
    t3.conns.put({ platform: 'instagram', status: 'needs_reauth', accessToken: 'x', pageToken: 'y' });
    t3.media.add({ id: 'm1' });
    t3.jobs.add(makeJob());
    assert.equal((await runInstagramJob(t3.env, CREATOR, 'job-1')).outcome, 'failed');
    assert.equal((await t3.jobs.get(CREATOR, 'job-1'))?.error_code, 'reauth');
  });
  it('carousel: one container per item, all children ready, then the carousel container and a single publish', async () => {
    okLimit();
    let n = 0;
    t.net.route('POST /ig_1/media_publish', () => json({ id: 'media1' }))
      .route('POST /ig_1/media', () => json({ id: `c${++n}` }))
      .on((c) => c.method === 'GET' && /\/c\d\?/.test(c.url), () => json({ status_code: 'FINISHED' }))
      .route('GET /media1', () => json({ id: 'media1', permalink: 'https://www.instagram.com/p/car/' }));
    for (const id of ['m1', 'm2', 'm3']) t.media.add({ id, ai_generated: id === 'm2' });
    t.jobs.add(makeJob({ format: 'carousel', media_asset_ids: ['m1', 'm2', 'm3'] }));
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'published');
    const creates = t.net.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ig_1/media')).map(form);
    assert.equal(creates.length, 4);
    assert.ok(creates.slice(0, 3).every((f) => f.get('is_carousel_item') === 'true' && !f.has('is_ai_generated')));
    assert.equal(creates[3].get('media_type'), 'CAROUSEL');
    assert.equal(creates[3].get('children'), 'c1,c2,c3');
    assert.equal(creates[3].get('is_ai_generated'), 'true');
    assert.equal(t.net.count('media_publish', 'POST'), 1);
    assert.equal(t.posts.posts[0].format, 'Carousel');
  });
  it('a crash after the children were created resumes with the same children', async () => {
    okLimit();
    t.net.route('POST /ig_1/media_publish', () => json({ id: 'media1' }))
      .route('POST /ig_1/media', () => json({ id: 'carousel9' }))
      .on((c) => c.method === 'GET' && /\/(c1|c2|carousel9)\?/.test(c.url), () => json({ status_code: 'FINISHED' }))
      .route('GET /media1', () => json({ id: 'media1' }));
    t.media.add({ id: 'm2' });
    t.jobs.add(makeJob({ format: 'carousel', media_asset_ids: ['m1', 'm2'], container_ids: ['c1', 'c2'], status: 'processing' }));
    const r = await runInstagramJob(t.env, CREATOR, 'job-1');
    assert.equal(r.outcome, 'published');
    assert.equal(t.net.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/ig_1/media')).length, 1, 'only the carousel container is new');
  });
  it('cron picker runs due jobs oldest first and stops at its time budget', async () => {
    happy();
    t.jobs.add(makeJob({ id: 'job-1' }));
    const out = await runDueInstagramJobs(t.env, { limit: 5, budgetMs: 45_000 });
    assert.equal(out.ran, 1);
    assert.equal(out.results.published, 1);
    const none = await runDueInstagramJobs(t.env, { limit: 5, budgetMs: 5_000 });
    assert.equal(none.ran, 0, 'less than 8 seconds left means no new job is started');
  });
  it('the sweeper parks interrupted Instagram publishes for review and expires abandoned YouTube uploads', async () => {
    const old = iso(START - 48 * 3_600_000);
    t.jobs.add(makeJob({ id: 'ig-stuck', status: 'uploading', updated_at: old }));
    t.jobs.add(makeJob({ id: 'yt-stuck', platform: 'youtube', format: 'video', status: 'uploading', updated_at: old, upload_session_uri: SESSION, media_asset_ids: [] }));
    t.jobs.add(makeJob({ id: 'fresh', status: 'uploading', updated_at: iso(START - 1000) }));
    const out = await sweepStuckJobs(t.env, 24 * 3_600_000);
    assert.deepEqual(out, { parked: 1, failed: 1 });
    assert.equal((await t.jobs.get(CREATOR, 'ig-stuck'))?.status, 'needs_review');
    const yt = await t.jobs.get(CREATOR, 'yt-stuck');
    assert.deepEqual([yt?.status, yt?.upload_session_uri], ['failed', null]);
    assert.equal((await t.jobs.get(CREATOR, 'fresh'))?.status, 'uploading');
  });
});

/* ───────────────────────────── analytics sync ───────────────────────────── */

describe('analytics sync', () => {
  it('pure helpers', () => {
    assert.deepEqual(youtubeDailyPoints({ headers: ['day', 'views', 'likes'], rows: [['2026-10-01', 5, null], ['2026-10-02', 7, 1]] as unknown as Array<Array<string | number>> }, 'UC1').map((p) => [p.metric, p.day, p.value]), [['views', '2026-10-01', 5], ['views', '2026-10-02', 7], ['likes', '2026-10-02', 1]]);
    assert.deepEqual(youtubeDailyPoints({ headers: ['views'], rows: [[1]] }, 'UC1'), []);
    assert.equal(youtubeFormat(60), 'Short video');
    assert.equal(youtubeFormat(61), 'Long video');
    assert.equal(youtubeFormat(null), 'Long video');
    assert.equal(instagramFormat({ mediaType: 'VIDEO', mediaProductType: 'REELS' }), 'Short video');
    assert.equal(instagramFormat({ mediaType: 'CAROUSEL_ALBUM', mediaProductType: 'FEED' }), 'Carousel');
    assert.equal(instagramFormat({ mediaType: 'IMAGE', mediaProductType: 'FEED' }), 'Image post');
    const p = { platform: 'youtube', scope: 'account', external_id: 'x', metric: 'views', kind: 'daily', window_days: 0, day: 'd', value: 1 } as const;
    assert.deepEqual(dedupePoints([p, { ...p, value: 2 }]).map((r) => r.value), [2]);
  });

  describe('YouTube', () => {
    let t: ReturnType<typeof makeEnv>;
    const routes = (opts: { hiddenSubs?: boolean; analyticsStatus?: number } = {}) => {
      t.net.route('GET /youtube/v3/channels', () => json({ items: [{ id: 'UC1', snippet: { title: 'Me' }, statistics: { subscriberCount: '120', viewCount: '5000', videoCount: '9', hiddenSubscriberCount: opts.hiddenSubs ?? false }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }))
        .route('GET /v2/reports', () => (opts.analyticsStatus ? json({ error: { code: opts.analyticsStatus, message: 'nope' } }, opts.analyticsStatus) : json({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-10-01', 5], ['2026-10-02', 8]] })))
        .route('GET /youtube/v3/playlistItems', () => json({ items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }] }))
        .route('GET /youtube/v3/videos', () => json({ items: [
          { id: 'v1', snippet: { title: 'Public', publishedAt: '2026-10-01T00:00:00Z' }, status: { privacyStatus: 'public' }, statistics: { viewCount: '10', likeCount: '2' }, contentDetails: { duration: 'PT30S' } },
          { id: 'v2', snippet: { title: 'Secret', publishedAt: '2026-10-02T00:00:00Z' }, status: { privacyStatus: 'private' }, statistics: { viewCount: '99' }, contentDetails: { duration: 'PT5M' } },
        ] }));
    };
    beforeEach(() => {
      t = makeEnv();
      t.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
    });

    it('stores exactly what YouTube returned, skips private videos, and records the sync time', async () => {
      routes();
      const s = await syncYouTube(t.env, CREATOR);
      assert.equal(s.ok, true);
      assert.deepEqual(t.analytics.find('subscribers').map((p) => p.value), [120]);
      assert.deepEqual(t.analytics.find('views', 'daily').map((p) => [p.day, p.value]), [['2026-10-01', 5], ['2026-10-02', 8]]);
      assert.deepEqual(t.analytics.find('views', 'lifetime').map((p) => [p.external_id, p.value]), [['v1', 10]]);
      assert.equal(t.analytics.find('comments', 'lifetime').length, 0, 'a statistic YouTube did not return is absent, not zero');
      assert.deepEqual([...t.analytics.posts.keys()], ['YouTube|v1']);
      assert.equal(t.analytics.posts.get('YouTube|v1')?.format, 'Short video');
      assert.equal(t.analytics.posts.get('YouTube|v1')?.shares, null);
      assert.ok((t.conns.rows.get(`${CREATOR}:youtube`) as { lastSyncedAt?: Date }).lastSyncedAt);
      assert.equal(await t.quota.used(CREATOR, 'youtube', 'default', pacificDay(NOW)), 4);
    });
    it('a channel that hides subscribers gets no subscriber number', async () => {
      routes({ hiddenSubs: true });
      const s = await syncYouTube(t.env, CREATOR);
      assert.equal(t.analytics.find('subscribers').length, 0);
      assert.ok(s.notes.some((n) => /hides its subscriber count/.test(n)));
    });
    it('Analytics API refusal degrades to a note; the rest still syncs', async () => {
      routes({ analyticsStatus: 403 });
      const s = await syncYouTube(t.env, CREATOR);
      assert.equal(s.ok, true);
      assert.ok(s.notes.some((n) => /Analytics was not available/.test(n)));
      assert.equal(t.analytics.find('views', 'daily').length, 0);
    });
    it('expected failures become messages, not exceptions', async () => {
      const none = makeEnv();
      assert.match((await syncYouTube(none.env, CREATOR)).error ?? '', /not connected/);
      const unconfigured = makeEnv();
      unconfigured.env.google = null;
      assert.match((await syncYouTube(unconfigured.env, CREATOR)).error ?? '', /not configured/);
      const exhausted = makeEnv();
      exhausted.conns.put({ platform: 'youtube', accessToken: 'AT', refreshToken: 'RT', accessTokenExpiresAt: new Date(START + 3_600_000) });
      await exhausted.quota.bump(CREATOR, 'youtube', 'default', pacificDay(NOW), 9_999);
      const r = await syncYouTube(exhausted.env, CREATOR);
      assert.equal(r.ok, false);
      assert.match(r.error ?? '', /quota is used up/);
      assert.equal(exhausted.net.calls.length, 0);
    });
  });

  describe('Instagram', () => {
    let t: ReturnType<typeof makeEnv>;
    beforeEach(() => {
      t = makeEnv();
      t.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START + 50 * 86_400_000) });
      t.net
        .on((c) => c.method === 'GET' && /\/ig_1\?/.test(c.url), () => json({ id: 'ig_1', username: 'me', followers_count: 150, media_count: 12 }))
        .on((c) => c.url.includes('/ig_1/insights') && c.url.includes('metric_type=time_series'), () => json({ data: [{ name: 'reach', values: [{ value: 3, end_time: '2026-10-02T07:00:00+0000' }, { value: 4, end_time: '2026-10-03T07:00:00+0000' }] }] }))
        .on((c) => c.url.includes('/ig_1/insights') && c.url.includes('metric=accounts_engaged'), () => json({ error: { code: 100, message: 'needs more followers' } }, 400))
        .on((c) => c.url.includes('/ig_1/insights'), (c) => json({ data: [{ name: new URL(c.url).searchParams.get('metric'), total_value: { value: 11 } }] }))
        .on((c) => c.method === 'GET' && c.url.includes('/ig_1/media?'), () => json({ data: [
          { id: 'p1', caption: 'A photo', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://www.instagram.com/p/1/', timestamp: '2026-10-01T10:00:00+0000', like_count: 5, comments_count: 1 },
          { id: 'r1', caption: 'A reel', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://www.instagram.com/reel/1/', timestamp: '2026-10-02T10:00:00+0000', like_count: 9, comments_count: 0 },
          { id: 's1', media_type: 'IMAGE', media_product_type: 'STORY', timestamp: '2026-10-03T10:00:00+0000' },
        ] }))
        .on((c) => /\/(p1|r1)\/insights/.test(c.url), (c) => json({ data: [{ name: 'views', values: [{ value: c.url.includes('/r1/') ? 500 : 80 }] }, { name: 'saved', values: [{ value: 3 }] }] }));
    });

    it('stores account, window and per-post numbers as returned, and says what Instagram would not return', async () => {
      const s = await syncInstagram(t.env, CREATOR);
      assert.equal(s.ok, true, s.error ?? '');
      assert.deepEqual(t.analytics.find('followers').map((p) => p.value), [150]);
      assert.deepEqual(t.analytics.find('reach', 'daily').map((p) => [p.day, p.value]), [['2026-10-02', 3], ['2026-10-03', 4]]);
      assert.ok(t.analytics.find('views', 'window').every((p) => p.window_days === 28 && p.value === 11));
      assert.equal(t.analytics.find('accounts_engaged').length, 0);
      assert.ok(s.notes.some((n) => /accounts_engaged/.test(n) && /100 or more followers/.test(n)));
      assert.equal(t.analytics.posts.has('Instagram|s1'), false, 'stories are not stored as posts');
      const reel = t.analytics.posts.get('Instagram|r1');
      assert.deepEqual([reel?.format, reel?.views, reel?.saves, reel?.likes, reel?.shares], ['Short video', 500, 3, 9, null]);
      assert.equal(t.analytics.posts.get('Instagram|p1')?.title, 'A photo');
    });
    it('a Meta back-off request skips the optional calls and says so', async () => {
      const calm = t.net;
      calm.calls.length = 0;
      const hot = makeEnv();
      hot.conns.put({ platform: 'instagram', accessToken: 'U', pageToken: 'P', accessTokenExpiresAt: new Date(START + 50 * 86_400_000) });
      hot.net.on(() => true, (c) => (/\/ig_1\?/.test(c.url)
        ? json({ id: 'ig_1', followers_count: 150, media_count: 1 }, 200, { 'x-app-usage': '{"call_count":95,"total_time":5,"total_cputime":5}' })
        : c.url.includes('/ig_1/insights') ? json({ data: [] })
        : c.url.includes('/ig_1/media?') ? json({ data: [{ id: 'p1', media_type: 'IMAGE', media_product_type: 'FEED', timestamp: '2026-10-01T10:00:00+0000', like_count: 1, comments_count: 0 }] })
        : json({ data: [] })));
      const s = await syncInstagram(hot.env, CREATOR);
      assert.equal(s.ok, true);
      assert.ok(s.notes.some((n) => /slow down/.test(n)));
      assert.equal(hot.net.calls.filter((c) => /\/p1\/insights/.test(c.url)).length, 0);
      assert.equal(hot.analytics.posts.get('Instagram|p1')?.views, null, 'a missing number stays missing');
    });
    it('a connection that needs reauth is reported, not retried', async () => {
      t.conns.put({ platform: 'instagram', status: 'needs_reauth', accessToken: 'U', pageToken: 'P' });
      const s = await syncInstagram(t.env, CREATOR);
      assert.deepEqual([s.ok, s.error], [false, 'Instagram needs to be reconnected.']);
    });
  });
});
