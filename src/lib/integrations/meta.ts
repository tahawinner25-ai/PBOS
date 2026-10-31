import { IntegrationError } from './errors';
import { formBody, request, requestJson } from './http';
import type { Deps } from './types';

/**
 * Meta: Facebook Login (OAuth) and the Instagram Graph API with Facebook Login, for Instagram
 * professional (Business or Creator) accounts linked to a Facebook Page.
 *
 * Token model: login returns a short-lived user token, which we trade for a long-lived (about 60 day)
 * user token. Page tokens obtained with a long-lived user token do not expire, and Instagram calls
 * use the Page token. We still refresh the user token before it lapses (connections.ts) because the
 * Page token stays valid only while the user's grant does.
 *
 * Secrets in requests: POST calls carry credentials in the form body; GET/DELETE calls carry
 * access_token in the query string because that is how the Graph API takes it. URLs are never logged
 * or put into error messages, and `redact()` strips token shapes from provider messages anyway.
 *
 * The Graph API version is configurable (META_GRAPH_VERSION). v26.0 was released on 2026-07-29.
 */

export const DEFAULT_GRAPH_VERSION = 'v26.0';

/** Needed to list Pages, read the linked Instagram account, publish, and read insights. */
export const META_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
] as const;

export type MetaApp = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  version: string;
  /** Facebook Login for Business configuration id. When set it replaces the `scope` parameter. */
  loginConfigId?: string | null;
  extraScopes?: string[];
};

export type MetaUsage = { percent: number; regainMinutes: number | null };

export type MetaCtx = { deps: Deps; version: string; onUsage?: (usage: MetaUsage) => void };

const graph = (version: string, path: string) => `https://graph.facebook.com/${version}/${path.replace(/^\//, '')}`;

/** Reads Meta's app and business-use-case usage headers (percent of the allowance used). */
export function parseMetaUsage(headers: Pick<Headers, 'get'>): MetaUsage | null {
  let percent = 0;
  let regain: number | null = null;
  const read = (raw: string | null) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  };
  const app = read(headers.get('x-app-usage')) as Record<string, number> | null;
  if (app) for (const v of Object.values(app)) if (typeof v === 'number') percent = Math.max(percent, v);
  const buc = read(headers.get('x-business-use-case-usage')) as Record<string, Array<Record<string, number>>> | null;
  if (buc) {
    for (const list of Object.values(buc)) {
      for (const entry of list ?? []) {
        for (const [k, v] of Object.entries(entry)) {
          if (k === 'estimated_time_to_regain_access' && typeof v === 'number' && v > 0) regain = Math.max(regain ?? 0, v);
          else if (k.startsWith('call_count') || k.startsWith('total_')) percent = Math.max(percent, v);
        }
      }
    }
  }
  return app || buc ? { percent, regainMinutes: regain } : null;
}

/** Past this, scheduled work should wait instead of risking a block. */
export const usageShouldBackOff = (usage: MetaUsage | null): boolean => usage !== null && (usage.percent >= 90 || (usage.regainMinutes ?? 0) > 0);

async function get<T>(ctx: MetaCtx, path: string, token: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const query = formBody({ ...params, access_token: token });
  return requestJson<T>(ctx.deps, `${graph(ctx.version, path)}?${query}`, {}, { platform: 'instagram', onResponse: (res) => report(ctx, res) });
}

async function post<T>(ctx: MetaCtx, path: string, token: string | null, fields: Record<string, string | number | boolean | undefined>, maxAttempts = 3): Promise<T> {
  return requestJson<T>(
    ctx.deps,
    graph(ctx.version, path),
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ ...fields, ...(token ? { access_token: token } : {}) }) },
    { platform: 'instagram', maxAttempts, onResponse: (res) => report(ctx, res) },
  );
}

function report(ctx: MetaCtx, res: Response) {
  const usage = parseMetaUsage(res.headers);
  if (usage) ctx.onUsage?.(usage);
}

// ── OAuth ──────────────────────────────────────────────────────────────────

export function buildMetaAuthUrl(args: { app: MetaApp; state: string }): string {
  const { app } = args;
  const url = new URL(`https://www.facebook.com/${app.version}/dialog/oauth`);
  const scopes = [...META_SCOPES, ...(app.extraScopes ?? [])];
  url.search = formBody({
    client_id: app.appId,
    redirect_uri: app.redirectUri,
    state: args.state,
    response_type: 'code',
    ...(app.loginConfigId ? { config_id: app.loginConfigId, override_default_response_type: 'true' } : { scope: scopes.join(',') }),
  }).toString();
  return url.toString();
}

type TokenResponse = { access_token?: string; token_type?: string; expires_in?: number };

export type MetaUserToken = { accessToken: string; expiresAt: Date };

const SIXTY_DAYS_SEC = 60 * 24 * 3600;

function toUserToken(body: TokenResponse, deps: Deps): MetaUserToken {
  if (!body.access_token) throw new IntegrationError({ kind: 'unknown', platform: 'oauth-meta', detail: 'token response was missing the token' });
  return { accessToken: body.access_token, expiresAt: new Date(deps.now().getTime() + (body.expires_in ?? SIXTY_DAYS_SEC) * 1000) };
}

/** Step 1: the authorization code becomes a short-lived user token. */
export async function exchangeMetaCode(ctx: MetaCtx, app: MetaApp, code: string): Promise<MetaUserToken> {
  const body = await post<TokenResponse>(ctx, 'oauth/access_token', null, {
    client_id: app.appId,
    client_secret: app.appSecret,
    redirect_uri: app.redirectUri,
    code,
  }, 2);
  return toUserToken(body, ctx.deps);
}

/** Step 2 (and every later refresh): a user token becomes a fresh long-lived (about 60 day) token. */
export async function exchangeForLongLived(ctx: MetaCtx, app: MetaApp, token: string): Promise<MetaUserToken> {
  const body = await post<TokenResponse>(ctx, 'oauth/access_token', null, {
    grant_type: 'fb_exchange_token',
    client_id: app.appId,
    client_secret: app.appSecret,
    fb_exchange_token: token,
  });
  return toUserToken(body, ctx.deps);
}

export async function getGrantedPermissions(ctx: MetaCtx, token: string): Promise<{ granted: string[]; declined: string[] }> {
  const body = await get<{ data?: Array<{ permission: string; status: string }> }>(ctx, 'me/permissions', token);
  const data = body.data ?? [];
  return { granted: data.filter((p) => p.status === 'granted').map((p) => p.permission), declined: data.filter((p) => p.status === 'declined').map((p) => p.permission) };
}

export async function getMetaUser(ctx: MetaCtx, token: string): Promise<{ id: string; name: string | null }> {
  const body = await get<{ id?: string; name?: string }>(ctx, 'me', token, { fields: 'id,name' });
  if (!body.id) throw new IntegrationError({ kind: 'unknown', platform: 'instagram', detail: 'profile response had no id' });
  return { id: body.id, name: body.name ?? null };
}

/** Removes the app's permissions on Meta's side (called on disconnect). Already-invalid tokens count as done. */
export async function revokeMetaPermissions(ctx: MetaCtx, token: string): Promise<void> {
  try {
    await request(ctx.deps, `${graph(ctx.version, 'me/permissions')}?${formBody({ access_token: token })}`, { method: 'DELETE' }, { platform: 'instagram', maxAttempts: 2 });
  } catch (err) {
    if (err instanceof IntegrationError && (err.kind === 'auth' || err.kind === 'invalid')) return;
    throw err;
  }
}

// ── Pages and the linked Instagram account ─────────────────────────────────

export type InstagramAccount = {
  id: string;
  username: string | null;
  name: string | null;
  profilePictureUrl: string | null;
  followersCount: number | null;
  mediaCount: number | null;
};

export type InstagramCandidate = { pageId: string; pageName: string; pageToken: string; instagram: InstagramAccount };

type PagesResponse = {
  data?: Array<{
    id: string;
    name?: string;
    access_token?: string;
    instagram_business_account?: { id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number };
  }>;
};

const IG_FIELDS = 'id,username,name,profile_picture_url,followers_count,media_count';

/** Pages the user granted that have an Instagram professional account attached. */
export async function listInstagramCandidates(ctx: MetaCtx, userToken: string): Promise<InstagramCandidate[]> {
  const body = await get<PagesResponse>(ctx, 'me/accounts', userToken, { fields: `id,name,access_token,instagram_business_account{${IG_FIELDS}}`, limit: 100 });
  const out: InstagramCandidate[] = [];
  for (const page of body.data ?? []) {
    const ig = page.instagram_business_account;
    if (!ig || !page.access_token) continue;
    out.push({
      pageId: page.id,
      pageName: page.name ?? 'Facebook Page',
      pageToken: page.access_token,
      instagram: {
        id: ig.id,
        username: ig.username ?? null,
        name: ig.name ?? null,
        profilePictureUrl: ig.profile_picture_url ?? null,
        followersCount: ig.followers_count ?? null,
        mediaCount: ig.media_count ?? null,
      },
    });
  }
  return out;
}

export async function getInstagramAccount(ctx: MetaCtx, pageToken: string, igUserId: string): Promise<InstagramAccount> {
  const body = await get<{ id: string; username?: string; name?: string; profile_picture_url?: string; followers_count?: number; media_count?: number }>(ctx, igUserId, pageToken, { fields: IG_FIELDS });
  return {
    id: body.id,
    username: body.username ?? null,
    name: body.name ?? null,
    profilePictureUrl: body.profile_picture_url ?? null,
    followersCount: body.followers_count ?? null,
    mediaCount: body.media_count ?? null,
  };
}

// ── publishing (two steps: create a container, then publish it) ────────────

export type ContainerRequest =
  | { kind: 'photo'; imageUrl: string; caption?: string; aiGenerated?: boolean }
  | { kind: 'reel'; videoUrl: string; caption?: string; aiGenerated?: boolean }
  | { kind: 'carousel_item'; mediaType: 'image' | 'video'; url: string }
  | { kind: 'carousel'; children: string[]; caption?: string; aiGenerated?: boolean };

/** Pure: the form fields for POST /{ig-user-id}/media. */
export function buildContainerFields(req: ContainerRequest): Record<string, string | boolean> {
  switch (req.kind) {
    case 'photo':
      return { image_url: req.imageUrl, ...(req.caption ? { caption: req.caption } : {}), ...(req.aiGenerated ? { is_ai_generated: true } : {}) };
    case 'reel':
      return { media_type: 'REELS', video_url: req.videoUrl, ...(req.caption ? { caption: req.caption } : {}), ...(req.aiGenerated ? { is_ai_generated: true } : {}) };
    case 'carousel_item':
      // The AI flag is set on the carousel container only: setting it on a child is an API error.
      return req.mediaType === 'image' ? { is_carousel_item: true, image_url: req.url } : { is_carousel_item: true, media_type: 'VIDEO', video_url: req.url };
    case 'carousel':
      return { media_type: 'CAROUSEL', children: req.children.join(','), ...(req.caption ? { caption: req.caption } : {}), ...(req.aiGenerated ? { is_ai_generated: true } : {}) };
  }
}

/** Step 1. Creating a container is harmless to repeat (unused containers expire after 24 hours). */
export async function createContainer(ctx: MetaCtx, pageToken: string, igUserId: string, req: ContainerRequest): Promise<string> {
  const body = await post<{ id?: string }>(ctx, `${igUserId}/media`, pageToken, buildContainerFields(req));
  if (!body.id) throw new IntegrationError({ kind: 'unknown', platform: 'instagram', detail: 'container response had no id' });
  return body.id;
}

export type ContainerStatus = 'IN_PROGRESS' | 'FINISHED' | 'ERROR' | 'EXPIRED' | 'PUBLISHED' | 'UNKNOWN';

export async function getContainerStatus(ctx: MetaCtx, pageToken: string, containerId: string): Promise<{ status: ContainerStatus; detail: string | null }> {
  const body = await get<{ status_code?: string; status?: string }>(ctx, containerId, pageToken, { fields: 'status_code,status' });
  const known: ContainerStatus[] = ['IN_PROGRESS', 'FINISHED', 'ERROR', 'EXPIRED', 'PUBLISHED'];
  const status = known.find((s) => s === body.status_code) ?? 'UNKNOWN';
  return { status, detail: body.status ?? null };
}

/**
 * Step 2. NEVER retried automatically: if the request times out after Meta applied it, a retry would
 * post twice. Callers record that publishing started first and treat an ambiguous failure as
 * "needs review".
 */
export async function publishContainer(ctx: MetaCtx, pageToken: string, igUserId: string, containerId: string): Promise<string> {
  const body = await post<{ id?: string }>(ctx, `${igUserId}/media_publish`, pageToken, { creation_id: containerId }, 1);
  if (!body.id) throw new IntegrationError({ kind: 'unknown', platform: 'instagram', detail: 'publish response had no media id' });
  return body.id;
}

export async function getMedia(ctx: MetaCtx, pageToken: string, mediaId: string): Promise<{ id: string; permalink: string | null; mediaProductType: string | null; timestamp: string | null }> {
  const body = await get<{ id: string; permalink?: string; media_product_type?: string; timestamp?: string }>(ctx, mediaId, pageToken, { fields: 'id,permalink,media_product_type,timestamp' });
  return { id: body.id, permalink: body.permalink ?? null, mediaProductType: body.media_product_type ?? null, timestamp: body.timestamp ?? null };
}

/** How many API-published posts the account has used in the rolling 24 hours (Meta's own counter). */
export async function getPublishingLimit(ctx: MetaCtx, pageToken: string, igUserId: string): Promise<{ used: number; total: number; windowSeconds: number }> {
  const body = await get<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }> }>(ctx, `${igUserId}/content_publishing_limit`, pageToken, { fields: 'quota_usage,config' });
  const row = body.data?.[0];
  return { used: row?.quota_usage ?? 0, total: row?.config?.quota_total ?? 100, windowSeconds: row?.config?.quota_duration ?? 86_400 };
}

// ── reading media and insights ─────────────────────────────────────────────

export type InstagramMedia = {
  id: string;
  caption: string | null;
  mediaType: string | null;
  mediaProductType: string | null;
  permalink: string | null;
  timestamp: string | null;
  likeCount: number | null;
  commentsCount: number | null;
};

export async function listRecentMedia(ctx: MetaCtx, pageToken: string, igUserId: string, limit = 25): Promise<InstagramMedia[]> {
  const body = await get<{ data?: Array<{ id: string; caption?: string; media_type?: string; media_product_type?: string; permalink?: string; timestamp?: string; like_count?: number; comments_count?: number }> }>(
    ctx,
    `${igUserId}/media`,
    pageToken,
    { fields: 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count', limit: Math.min(Math.max(limit, 1), 50) },
  );
  return (body.data ?? []).map((m) => ({
    id: m.id,
    caption: m.caption ?? null,
    mediaType: m.media_type ?? null,
    mediaProductType: m.media_product_type ?? null,
    permalink: m.permalink ?? null,
    timestamp: m.timestamp ?? null,
    likeCount: m.like_count ?? null,
    commentsCount: m.comments_count ?? null,
  }));
}

/** Account metrics that return one number for a date range (`metric_type=total_value`). */
export const IG_ACCOUNT_TOTAL_METRICS = ['views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'profile_links_taps'] as const;
/** Account metrics that support a per-day series. Only `reach` does. `impressions` is deprecated and not used. */
export const IG_ACCOUNT_SERIES_METRICS = ['reach'] as const;

const MEDIA_METRICS_COMMON = ['views', 'reach', 'saved', 'shares', 'total_interactions', 'likes', 'comments'];
export const IG_MEDIA_METRICS: Record<string, string[]> = {
  FEED: MEDIA_METRICS_COMMON,
  REELS: [...MEDIA_METRICS_COMMON, 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time'],
  STORY: ['views', 'reach', 'shares', 'total_interactions', 'replies'],
};

export type InsightValue = { name: string; total: number | null; series: Array<{ day: string; value: number }> };

type InsightsResponse = {
  data?: Array<{ name: string; total_value?: { value?: number }; values?: Array<{ value?: number; end_time?: string }> }>;
};

function parseInsights(body: InsightsResponse): InsightValue[] {
  return (body.data ?? []).map((row) => ({
    name: row.name,
    total: typeof row.total_value?.value === 'number' ? row.total_value.value : typeof row.values?.[0]?.value === 'number' && !row.values?.[0]?.end_time ? row.values[0].value : null,
    // Each value is dated by the end of its day window (UTC date of end_time).
    series: (row.values ?? []).filter((v) => typeof v.value === 'number' && v.end_time).map((v) => ({ day: (v.end_time as string).slice(0, 10), value: v.value as number })),
  }));
}

/**
 * Account insights for [since, until] (Unix seconds). Each metric is requested on its own, so a
 * metric an account is not eligible for (for example anything that needs 100 followers) cannot
 * blank out the others. Returns the metrics that succeeded and the names that did not.
 */
export async function getAccountInsights(
  ctx: MetaCtx,
  pageToken: string,
  igUserId: string,
  args: { metrics: readonly string[]; metricType: 'total_value' | 'time_series'; since: number; until: number },
): Promise<{ values: InsightValue[]; skipped: string[] }> {
  const values: InsightValue[] = [];
  const skipped: string[] = [];
  for (const metric of args.metrics) {
    try {
      const body = await get<InsightsResponse>(ctx, `${igUserId}/insights`, pageToken, {
        metric,
        period: 'day',
        metric_type: args.metricType,
        since: args.since,
        until: args.until,
      });
      values.push(...parseInsights(body));
    } catch (err) {
      // An unsupported metric is "invalid" or "permission"; anything else (auth, rate limit) must stop the run.
      if (err instanceof IntegrationError && (err.kind === 'invalid' || err.kind === 'permission')) skipped.push(metric);
      else throw err;
    }
  }
  return { values, skipped };
}

/** Lifetime insights for one media object. Unsupported metrics are skipped, not fatal. */
export async function getMediaInsights(ctx: MetaCtx, pageToken: string, mediaId: string, metrics: string[]): Promise<{ values: Record<string, number>; skipped: string[] }> {
  const values: Record<string, number> = {};
  const skipped: string[] = [];
  try {
    const body = await get<InsightsResponse>(ctx, `${mediaId}/insights`, pageToken, { metric: metrics.join(',') });
    for (const v of parseInsights(body)) if (v.total !== null) values[v.name] = v.total;
    return { values, skipped };
  } catch (err) {
    if (!(err instanceof IntegrationError) || (err.kind !== 'invalid' && err.kind !== 'permission')) throw err;
  }
  // One unsupported metric fails the whole batch; ask for them one at a time instead.
  for (const metric of metrics) {
    try {
      const body = await get<InsightsResponse>(ctx, `${mediaId}/insights`, pageToken, { metric });
      for (const v of parseInsights(body)) if (v.total !== null) values[v.name] = v.total;
    } catch (err) {
      if (err instanceof IntegrationError && (err.kind === 'invalid' || err.kind === 'permission')) skipped.push(metric);
      else throw err;
    }
  }
  return { values, skipped };
}
