import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { IntegrationError } from '../src/lib/integrations/errors';
import { YOUTUBE_SCOPES, buildGoogleAuthUrl, exchangeGoogleCode, missingScopes, refreshGoogleAccessToken, revokeGoogleToken } from '../src/lib/integrations/google';
import {
  CHUNK_QUANTUM, assertGoogleUploadUri, buildVideoResource, getMyChannel, getVideos, listRecentUploads, parseIsoDuration, queryAnalytics, queryUploadStatus,
  startResumableUpload, uploadChunk,
} from '../src/lib/integrations/youtube';
import {
  META_SCOPES, buildContainerFields, buildMetaAuthUrl, createContainer, exchangeForLongLived, exchangeMetaCode, getAccountInsights, getContainerStatus, getMediaInsights,
  getPublishingLimit, listInstagramCandidates, parseMetaUsage, publishContainer, revokeMetaPermissions, usageShouldBackOff, type MetaApp, type MetaCtx,
} from '../src/lib/integrations/meta';
import { parseInstagramWebhook, parseSignedRequest, verifyWebhookChallenge, verifyWebhookSignature } from '../src/lib/integrations/webhooks';
import { FakeNet, SECRET_TOKEN, bare, form, json, makeDeps } from './integration-fakes';

const client = { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.example/api/connect/youtube/callback' };

describe('Google OAuth', () => {
  it('builds an offline, consent-forcing, PKCE authorization URL with least-privilege scopes', () => {
    const url = new URL(buildGoogleAuthUrl({ client, scopes: YOUTUBE_SCOPES, state: 'st', codeChallenge: 'ch' }));
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    const p = url.searchParams;
    assert.equal(p.get('access_type'), 'offline');
    assert.equal(p.get('prompt'), 'consent');
    assert.equal(p.get('response_type'), 'code');
    assert.equal(p.get('code_challenge_method'), 'S256');
    assert.equal(p.get('code_challenge'), 'ch');
    assert.equal(p.get('state'), 'st');
    assert.equal(p.get('include_granted_scopes'), 'true');
    assert.deepEqual(p.get('scope')?.split(' '), YOUTUBE_SCOPES);
    assert.ok(!YOUTUBE_SCOPES.some((s) => /auth\/youtube$|force-ssl|youtubepartner/.test(s)), 'no broad YouTube scopes');
    assert.ok(!url.toString().includes('csecret'));
  });
  it('exchanges a code with the verifier in the POST body, not the URL', async () => {
    const net = new FakeNet().route('POST oauth2.googleapis.com/token', () => json({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: YOUTUBE_SCOPES.join(' ') }));
    const deps = makeDeps(net);
    const tokens = await exchangeGoogleCode(deps, client, 'the-code', 'the-verifier');
    assert.equal(tokens.refreshToken, 'rt');
    assert.equal(tokens.expiresAt.getTime(), deps.clock.now + 3_600_000);
    const call = net.calls[0];
    assert.ok(!call.url.includes('the-code') && !call.url.includes('csecret'));
    const body = form(call);
    assert.equal(body.get('code_verifier'), 'the-verifier');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.deepEqual(missingScopes(tokens.scopes, YOUTUBE_SCOPES), []);
    assert.deepEqual(missingScopes(['https://www.googleapis.com/auth/youtube.upload'], YOUTUBE_SCOPES).length, 2);
  });
  it('explains a missing refresh token instead of storing a connection that dies in an hour', async () => {
    const net = new FakeNet().route('POST /token', () => json({ access_token: 'at', expires_in: 3600, scope: '' }));
    await assert.rejects(exchangeGoogleCode(makeDeps(net), client, 'c', 'v'), (e) => e instanceof IntegrationError && e.code === 'no_refresh_token' && /Third-party access/.test(e.userMessage));
  });
  it('refresh: success, and invalid_grant is an auth error that is not retried', async () => {
    const ok = new FakeNet().route('POST /token', () => json({ access_token: 'new', expires_in: 3599 }));
    const t = await refreshGoogleAccessToken(makeDeps(ok), client, 'rt');
    assert.equal(t.accessToken, 'new');
    assert.equal(t.refreshToken, null);
    const dead = new FakeNet().route('POST /token', () => json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400));
    await assert.rejects(refreshGoogleAccessToken(makeDeps(dead), client, 'rt'), (e) => e instanceof IntegrationError && e.kind === 'auth');
    assert.equal(dead.calls.length, 1);
  });
  it('revoke tolerates a token that is already invalid but not a server failure', async () => {
    await revokeGoogleToken(makeDeps(new FakeNet().route('POST /revoke', () => json({ error: 'invalid_token' }, 400))), 't');
    await assert.rejects(revokeGoogleToken(makeDeps(new FakeNet().route('POST /revoke', () => bare(500))), 't'));
  });
});

describe('YouTube', () => {
  const meta = { title: 'T', description: 'D', tags: ['a'], privacy: 'public' as const, publishAt: null, madeForKids: false, isShort: false };

  it('video resource: scheduled uploads are private until publishAt; Shorts get #Shorts once', () => {
    const plain = buildVideoResource(meta);
    assert.deepEqual(plain.status, { privacyStatus: 'public', selfDeclaredMadeForKids: false, embeddable: true });
    const when = '2026-11-01T10:00:00Z';
    const scheduled = buildVideoResource({ ...meta, publishAt: when });
    assert.equal(scheduled.status.privacyStatus, 'private');
    assert.equal(scheduled.status.publishAt, '2026-11-01T10:00:00.000Z');
    assert.match(String(buildVideoResource({ ...meta, isShort: true }).snippet.description), /#Shorts$/);
    assert.equal((String(buildVideoResource({ ...meta, isShort: true, description: 'x #shorts' }).snippet.description).match(/#shorts/gi) ?? []).length, 1);
    assert.equal(buildVideoResource({ ...meta, madeForKids: true }).status.selfDeclaredMadeForKids, true);
  });
  it('only ever uses Google-issued upload addresses (no server-side request forgery)', () => {
    assert.doesNotThrow(() => assertGoogleUploadUri('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=x'));
    for (const bad of ['http://www.googleapis.com/upload/youtube/v3/videos', 'https://evil.example/upload/', 'https://www.googleapis.com.evil.example/upload/x', 'https://www.googleapis.com/other/path', 'not a url', 'https://169.254.169.254/upload/']) {
      assert.throws(() => assertGoogleUploadUri(bad), IntegrationError, bad);
    }
  });
  it('starts a resumable session with the documented headers and returns the Location', async () => {
    const location = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc';
    const net = new FakeNet().route('POST /upload/youtube/v3/videos', () => bare(200, { location }));
    const uri = await startResumableUpload(makeDeps(net), SECRET_TOKEN, { metadata: meta, size: 1234, mime: 'video/mp4' });
    assert.equal(uri, location);
    const c = net.calls[0];
    assert.equal(c.headers['x-upload-content-length'], '1234');
    assert.equal(c.headers['x-upload-content-type'], 'video/mp4');
    assert.equal(c.headers.authorization, `Bearer ${SECRET_TOKEN}`);
    assert.ok(c.url.includes('uploadType=resumable') && c.url.includes('part=snippet%2Cstatus'));
    assert.ok(!c.url.includes(SECRET_TOKEN));
  });
  it('refuses a session address that is not Google\'s', async () => {
    const net = new FakeNet().route('POST /upload', () => bare(200, { location: 'https://evil.example/upload/x' }));
    await assert.rejects(startResumableUpload(makeDeps(net), 't', { metadata: meta, size: 10, mime: 'video/mp4' }), IntegrationError);
  });
  it('chunks: Content-Range, resume (308) parsing, completion, and size rules', async () => {
    const uri = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';
    const chunk = new Uint8Array(CHUNK_QUANTUM * 2);
    const total = CHUNK_QUANTUM * 5 + 100;
    const net = new FakeNet()
      .route('PUT /upload', () => bare(308, { range: `bytes=0-${chunk.length - 1}` }), { once: true })
      .route('PUT /upload', () => json({ id: 'vid1', status: { privacyStatus: 'public' } }));
    const deps = makeDeps(net);
    const first = await uploadChunk(deps, { sessionUri: uri, chunk, offset: 0, total, mime: 'video/mp4' });
    assert.deepEqual(first, { done: false, nextOffset: chunk.length });
    assert.equal(net.calls[0].headers['content-range'], `bytes 0-${chunk.length - 1}/${total}`);
    assert.equal(net.calls[0].headers.authorization, undefined, 'the session URI authorises; no bearer token is sent');
    const last = await uploadChunk(deps, { sessionUri: uri, chunk: new Uint8Array(100), offset: CHUNK_QUANTUM * 5, total, mime: 'video/mp4' });
    assert.equal(last.done, true);
    await assert.rejects(uploadChunk(deps, { sessionUri: uri, chunk: new Uint8Array(1000), offset: 0, total, mime: 'video/mp4' }), /multiple of 256 KiB/);
    await assert.rejects(uploadChunk(deps, { sessionUri: uri, chunk: new Uint8Array(0), offset: 0, total, mime: 'video/mp4' }));
    await assert.rejects(uploadChunk(deps, { sessionUri: uri, chunk, offset: total, total, mime: 'video/mp4' }));
  });
  it('status query: no Range header means nothing stored yet', async () => {
    const uri = 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=abc';
    const empty = new FakeNet().route('PUT /upload', () => bare(308));
    assert.deepEqual(await queryUploadStatus(makeDeps(empty), { sessionUri: uri, total: 10 }), { done: false, nextOffset: 0 });
    assert.equal(empty.calls[0].headers['content-range'], 'bytes */10');
  });
  it('channel: statistics, hidden subscribers, and a clear error for accounts without a channel', async () => {
    const net = new FakeNet().route('GET /youtube/v3/channels', () => json({ items: [{ id: 'UC1', snippet: { title: 'Me', thumbnails: { default: { url: 'u' } } }, statistics: { subscriberCount: '120', viewCount: '5000', videoCount: '9', hiddenSubscriberCount: false }, contentDetails: { relatedPlaylists: { uploads: 'UU1' } } }] }));
    const ch = await getMyChannel(makeDeps(net), 't');
    assert.deepEqual([ch.id, ch.subscriberCount, ch.viewCount, ch.uploadsPlaylistId], ['UC1', 120, 5000, 'UU1']);
    const hidden = new FakeNet().route('GET /channels', () => json({ items: [{ id: 'UC2', statistics: { subscriberCount: '7', hiddenSubscriberCount: true } }] }));
    assert.equal((await getMyChannel(makeDeps(hidden), 't')).subscriberCount, null);
    await assert.rejects(getMyChannel(makeDeps(new FakeNet().route('GET /channels', () => json({ items: [] }))), 't'), (e) => e instanceof IntegrationError && e.code === 'no_channel');
  });
  it('videos: parses statistics and ISO durations; batches ids; uses the uploads playlist', async () => {
    assert.equal(parseIsoDuration('PT1H2M3S'), 3723);
    assert.equal(parseIsoDuration('PT45S'), 45);
    assert.equal(parseIsoDuration('P0D'), 0);
    assert.equal(parseIsoDuration('garbage'), null);
    const net = new FakeNet()
      .route('GET /youtube/v3/playlistItems', () => json({ items: [{ contentDetails: { videoId: 'v1' } }, { contentDetails: { videoId: 'v2' } }] }))
      .route('GET /youtube/v3/videos', () => json({ items: [{ id: 'v1', snippet: { title: 'One', publishedAt: '2026-10-01T00:00:00Z' }, status: { privacyStatus: 'public' }, statistics: { viewCount: '10', likeCount: '2' }, contentDetails: { duration: 'PT30S' } }, { id: 'v2', statistics: {} }] }));
    const vids = await listRecentUploads(makeDeps(net), 't', 'UU1', 10);
    assert.equal(vids.length, 2);
    assert.deepEqual([vids[0].views, vids[0].likes, vids[0].comments, vids[0].durationSeconds], [10, 2, null, 30]);
    assert.equal(vids[1].views, null, 'a missing statistic stays null, never zero');
    const many = new FakeNet().route('GET /youtube/v3/videos', () => json({ items: [] }));
    await getVideos(makeDeps(many), 't', Array.from({ length: 120 }, (_, i) => `v${i}`));
    assert.equal(many.calls.length, 3);
  });
  it('analytics query for the signed-in channel with day dimension', async () => {
    const net = new FakeNet().route('GET /v2/reports', () => json({ columnHeaders: [{ name: 'day' }, { name: 'views' }], rows: [['2026-10-01', 5]] }));
    const report = await queryAnalytics(makeDeps(net), 't', { startDate: '2026-10-01', endDate: '2026-10-02', metrics: ['views'], dimensions: ['day'], sort: 'day' });
    assert.deepEqual(report, { headers: ['day', 'views'], rows: [['2026-10-01', 5]] });
    const p = new URL(net.calls[0].url).searchParams;
    assert.equal(p.get('ids'), 'channel==MINE');
    assert.equal(p.get('dimensions'), 'day');
  });
});

describe('Meta', () => {
  const app: MetaApp = { appId: 'aid', appSecret: 'asecret', redirectUri: 'https://app.example/api/connect/instagram/callback', version: 'v26.0' };
  const ctx = (net: FakeNet): MetaCtx => ({ deps: makeDeps(net), version: 'v26.0' });

  it('authorization URL: documented permissions by default; config_id replaces scope for Login for Business', () => {
    const url = new URL(buildMetaAuthUrl({ app, state: 'st' }));
    assert.equal(url.pathname, '/v26.0/dialog/oauth');
    assert.deepEqual(url.searchParams.get('scope')?.split(','), [...META_SCOPES]);
    for (const needed of ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_read_engagement']) assert.ok(META_SCOPES.includes(needed as never));
    assert.ok(!url.toString().includes('asecret'));
    const biz = new URL(buildMetaAuthUrl({ app: { ...app, loginConfigId: 'cfg1' }, state: 'st' }));
    assert.equal(biz.searchParams.get('config_id'), 'cfg1');
    assert.equal(biz.searchParams.get('scope'), null);
  });
  it('token exchanges are POSTs with the secret in the body, never in the URL', async () => {
    const net = new FakeNet().route('POST /oauth/access_token', (c) => (form(c).get('grant_type') === 'fb_exchange_token' ? json({ access_token: 'LONG', expires_in: 5_184_000 }) : json({ access_token: 'SHORT', expires_in: 3600 })));
    const c = ctx(net);
    const short = await exchangeMetaCode(c, app, 'code1');
    assert.equal(short.accessToken, 'SHORT');
    const long = await exchangeForLongLived(c, app, short.accessToken);
    assert.equal(long.accessToken, 'LONG');
    assert.equal(long.expiresAt.getTime(), c.deps.now().getTime() + 5_184_000_000);
    for (const call of net.calls) assert.ok(!call.url.includes('asecret') && !call.url.includes('code1') && !call.url.includes('SHORT'));
    assert.equal(form(net.calls[1]).get('client_secret'), 'asecret');
  });
  it('container fields per kind; the AI label goes on the container, never on carousel children', () => {
    assert.deepEqual(buildContainerFields({ kind: 'photo', imageUrl: 'https://i/x.jpg', caption: 'c' }), { image_url: 'https://i/x.jpg', caption: 'c' });
    assert.deepEqual(buildContainerFields({ kind: 'photo', imageUrl: 'u', aiGenerated: true }), { image_url: 'u', is_ai_generated: true });
    assert.deepEqual(buildContainerFields({ kind: 'reel', videoUrl: 'v' }), { media_type: 'REELS', video_url: 'v' });
    assert.deepEqual(buildContainerFields({ kind: 'carousel_item', mediaType: 'image', url: 'u' }), { is_carousel_item: true, image_url: 'u' });
    assert.deepEqual(buildContainerFields({ kind: 'carousel_item', mediaType: 'video', url: 'u' }), { is_carousel_item: true, media_type: 'VIDEO', video_url: 'u' });
    const car = buildContainerFields({ kind: 'carousel', children: ['1', '2'], caption: 'c', aiGenerated: true });
    assert.deepEqual(car, { media_type: 'CAROUSEL', children: '1,2', caption: 'c', is_ai_generated: true });
    assert.equal('is_ai_generated' in buildContainerFields({ kind: 'carousel_item', mediaType: 'image', url: 'u' }), false);
  });
  it('create, poll and publish: publish is sent once and never retried', async () => {
    const net = new FakeNet()
      .route('POST /ig1/media_publish', () => bare(503))
      .route('POST /ig1/media', () => json({ id: 'cont1' }))
      .route('GET /cont1', () => json({ status_code: 'FINISHED' }));
    const c = ctx(net);
    assert.equal(await createContainer(c, 'PAGETOKEN', 'ig1', { kind: 'photo', imageUrl: 'u' }), 'cont1');
    assert.deepEqual(await getContainerStatus(c, 'PAGETOKEN', 'cont1'), { status: 'FINISHED', detail: null });
    await assert.rejects(publishContainer(c, 'PAGETOKEN', 'ig1', 'cont1'));
    assert.equal(net.count('media_publish', 'POST'), 1);
    assert.equal(form(net.calls[0]).get('access_token'), 'PAGETOKEN');
  });
  it('publishing limit comes from Meta\'s own counter', async () => {
    const net = new FakeNet().route('GET /ig1/content_publishing_limit', () => json({ data: [{ quota_usage: 7, config: { quota_total: 100, quota_duration: 86400 } }] }));
    assert.deepEqual(await getPublishingLimit(ctx(net), 't', 'ig1'), { used: 7, total: 100, windowSeconds: 86400 });
  });
  it('page discovery keeps only Pages that have an Instagram professional account', async () => {
    const net = new FakeNet().route('GET /me/accounts', () => json({ data: [{ id: 'p1', name: 'No IG', access_token: 'pt1' }, { id: 'p2', name: 'With IG', access_token: 'pt2', instagram_business_account: { id: 'ig2', username: 'me', followers_count: 150 } }] }));
    const found = await listInstagramCandidates(ctx(net), 'ut');
    assert.deepEqual(found.map((f) => [f.pageId, f.instagram.id, f.instagram.followersCount]), [['p2', 'ig2', 150]]);
  });
  it('account insights: each metric is asked separately, ineligible metrics are skipped, hard errors stop the run', async () => {
    const net = new FakeNet().on((c) => c.url.includes('/ig1/insights') && c.url.includes('metric=accounts_engaged'), () => json({ error: { code: 100, message: 'needs 100 followers' } }, 400))
      .on((c) => c.url.includes('/ig1/insights'), (c) => json({ data: [{ name: new URL(c.url).searchParams.get('metric'), total_value: { value: 42 } }] }));
    const out = await getAccountInsights(ctx(net), 't', 'ig1', { metrics: ['views', 'accounts_engaged'], metricType: 'total_value', since: 1, until: 2 });
    assert.deepEqual(out.values.map((v) => [v.name, v.total]), [['views', 42]]);
    assert.deepEqual(out.skipped, ['accounts_engaged']);
    const bad = new FakeNet().route('GET /ig1/insights', () => json({ error: { code: 190 } }, 400));
    await assert.rejects(getAccountInsights(ctx(bad), 't', 'ig1', { metrics: ['views'], metricType: 'total_value', since: 1, until: 2 }), (e) => e instanceof IntegrationError && e.kind === 'auth');
  });
  it('time series insights are dated by their end_time', async () => {
    const net = new FakeNet().route('GET /ig1/insights', () => json({ data: [{ name: 'reach', values: [{ value: 3, end_time: '2026-10-02T07:00:00+0000' }, { value: 4, end_time: '2026-10-03T07:00:00+0000' }] }] }));
    const out = await getAccountInsights(ctx(net), 't', 'ig1', { metrics: ['reach'], metricType: 'time_series', since: 1, until: 2 });
    assert.deepEqual(out.values[0].series, [{ day: '2026-10-02', value: 3 }, { day: '2026-10-03', value: 4 }]);
  });
  it('media insights fall back to one metric at a time when a batch is refused', async () => {
    const net = new FakeNet().on((c) => c.url.includes('metric=views%2Csaved'), () => json({ error: { code: 100 } }, 400))
      .on((c) => c.url.includes('metric=views'), () => json({ data: [{ name: 'views', values: [{ value: 9 }] }] }))
      .on((c) => c.url.includes('metric=saved'), () => json({ error: { code: 100 } }, 400));
    const out = await getMediaInsights(ctx(net), 't', 'm1', ['views', 'saved']);
    assert.deepEqual(out, { values: { views: 9 }, skipped: ['saved'] });
  });
  it('usage headers: back off at 90 percent or when Meta says to wait', () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    assert.equal(parseMetaUsage(h({})), null);
    const hot = parseMetaUsage(h({ 'x-app-usage': '{"call_count":95,"total_time":10,"total_cputime":5}' }));
    assert.ok(usageShouldBackOff(hot));
    const calm = parseMetaUsage(h({ 'x-app-usage': '{"call_count":10,"total_time":3,"total_cputime":2}' }));
    assert.ok(!usageShouldBackOff(calm));
    const waiting = parseMetaUsage(h({ 'x-business-use-case-usage': '{"123":[{"type":"instagram","call_count":5,"estimated_time_to_regain_access":12}]}' }));
    assert.ok(usageShouldBackOff(waiting));
  });
  it('revoking permissions tolerates an already-invalid token', async () => {
    await revokeMetaPermissions(ctx(new FakeNet().route('DELETE /me/permissions', () => json({ error: { code: 190 } }, 400))), 't');
    await assert.rejects(revokeMetaPermissions(ctx(new FakeNet().route('DELETE /me/permissions', () => bare(500))), 't'));
  });
});

describe('Meta webhooks and callbacks', () => {
  const secret = 'app-secret-value';
  const sign = (body: string) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('echoes the challenge only for the right verify token', () => {
    const q = (o: Record<string, string>) => new URLSearchParams(o);
    assert.equal(verifyWebhookChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '123' }), 'tok'), '123');
    assert.equal(verifyWebhookChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '123' }), 'tok'), null);
    assert.equal(verifyWebhookChallenge(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '1' }), 'tok'), null);
    assert.equal(verifyWebhookChallenge(q({ 'hub.mode': 'subscribe', 'hub.challenge': '1' }), 'tok'), null);
    assert.equal(verifyWebhookChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '1' }), ''), null, 'an unset verify token never matches');
  });
  it('accepts only bodies signed with the app secret, over the raw bytes', () => {
    const body = '{"object":"instagram","entry":[]}';
    assert.equal(verifyWebhookSignature(body, sign(body), secret), true);
    assert.equal(verifyWebhookSignature(body + ' ', sign(body), secret), false);
    assert.equal(verifyWebhookSignature(body, sign(body), 'other'), false);
    assert.equal(verifyWebhookSignature(body, null, secret), false);
    assert.equal(verifyWebhookSignature(body, 'sha1=abc', secret), false);
    assert.equal(verifyWebhookSignature(body, 'sha256=short', secret), false);
    assert.equal(verifyWebhookSignature(body, sign(body), ''), false);
  });
  it('parses signed_request for deauthorize and data deletion', () => {
    const payload = Buffer.from(JSON.stringify({ algorithm: 'HMAC-SHA256', user_id: 'fb-42', issued_at: 1 })).toString('base64url');
    const sig = createHmac('sha256', secret).update(payload).digest('base64url');
    assert.equal(parseSignedRequest(`${sig}.${payload}`, secret)?.user_id, 'fb-42');
    assert.equal(parseSignedRequest(`${sig}.${payload}`, 'other'), null);
    assert.equal(parseSignedRequest(`bad.${payload}`, secret), null);
    assert.equal(parseSignedRequest('nodot', secret), null);
    const wrongAlg = Buffer.from(JSON.stringify({ algorithm: 'none', user_id: 'x' })).toString('base64url');
    assert.equal(parseSignedRequest(`${createHmac('sha256', secret).update(wrongAlg).digest('base64url')}.${wrongAlg}`, secret), null);
  });
  it('parses Instagram deliveries defensively', () => {
    const items = parseInstagramWebhook({ object: 'instagram', entry: [{ id: 'ig1', changes: [{ field: 'story_insights', value: { media_id: 'm' } }, { field: 5 }] }, { id: 7 }] });
    assert.deepEqual(items, [{ igUserId: 'ig1', field: 'story_insights', value: { media_id: 'm' } }]);
    assert.deepEqual(parseInstagramWebhook({ object: 'page', entry: [] }), []);
    assert.deepEqual(parseInstagramWebhook(null), []);
    assert.deepEqual(parseInstagramWebhook('x'), []);
  });
});
