import { NotConnectedError, ReauthRequiredError, getInstagramCreds, getYouTubeToken } from './connections';
import { IntegrationError } from './errors';
import {
  IG_ACCOUNT_SERIES_METRICS, IG_ACCOUNT_TOTAL_METRICS, IG_MEDIA_METRICS, getAccountInsights, getInstagramAccount, getMediaInsights, listRecentMedia,
  usageShouldBackOff, type InstagramMedia, type MetaUsage,
} from './meta';
import type { Env, PointRow, SyncedPostRow } from './ports';
import { reserveYoutube } from './quota';
import type { Platform } from './types';
import { getMyChannel, listRecentUploads, queryAnalytics, type AnalyticsReport, type YouTubeVideo } from './youtube';

/**
 * Pulls real numbers from YouTube and Instagram and stores them exactly as the platforms returned
 * them (analytics_points, plus metrics on the matching posts rows). Nothing is estimated or filled
 * in: a metric the platform did not return is simply absent, and the app shows an empty state.
 *
 * Limits worth knowing: YouTube Analytics data lags by a couple of days; Instagram insights can lag
 * by up to 48 hours, and some account metrics need 100+ followers (those are skipped, not faked).
 */

export type SyncSummary = { platform: Platform; ok: boolean; points: number; posts: number; notes: string[]; error?: string };

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export function dedupePoints(rows: PointRow[]): PointRow[] {
  const map = new Map<string, PointRow>();
  for (const r of rows) map.set([r.platform, r.scope, r.external_id, r.metric, r.kind, r.window_days, r.day].join('|'), r);
  return [...map.values()];
}

// ── YouTube ────────────────────────────────────────────────────────────────

const YT_DAILY_METRICS = ['views', 'estimatedMinutesWatched', 'averageViewDuration', 'subscribersGained', 'subscribersLost', 'likes', 'comments', 'shares'];

/** Rows of a `dimensions=day` report become one daily point per metric. */
export function youtubeDailyPoints(report: AnalyticsReport, channelId: string): PointRow[] {
  const dayIndex = report.headers.indexOf('day');
  if (dayIndex < 0) return [];
  const out: PointRow[] = [];
  for (const row of report.rows) {
    const day = String(row[dayIndex]);
    report.headers.forEach((metric, i) => {
      const value = row[i];
      if (i !== dayIndex && typeof value === 'number' && Number.isFinite(value)) {
        out.push({ platform: 'youtube', scope: 'account', external_id: channelId, metric, kind: 'daily', window_days: 0, day, value });
      }
    });
  }
  return out;
}

/** Duration is the only format signal YouTube gives us: 60 seconds or less is labelled "Short video". The creator can edit it. */
export const youtubeFormat = (seconds: number | null): string => (seconds !== null && seconds <= 60 ? 'Short video' : 'Long video');

export function youtubePostRow(v: YouTubeVideo): SyncedPostRow {
  return {
    platform: 'YouTube', format: youtubeFormat(v.durationSeconds), title: v.title || null, published_at: v.publishedAt, views: v.views, likes: v.likes,
    comments: v.comments, shares: null, saves: null, external_id: v.id, external_url: `https://www.youtube.com/watch?v=${v.id}`, source: 'youtube',
  };
}

export async function syncYouTube(env: Env, creatorId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { platform: 'youtube', ok: false, points: 0, posts: 0, notes: [] };
  if (!env.google) return { ...summary, error: 'YouTube is not configured on this deployment.' };
  try {
    const now = env.deps.now();
    const reservation = await reserveYoutube(env.quota, { creatorId, bucket: 'default', units: 4, config: env.quotaConfig, now });
    if (!reservation.ok) return { ...summary, error: `YouTube's daily quota is used up (${reservation.used} of ${reservation.limit}). It resets at ${reservation.retryAt.toISOString()}.` };

    const { token } = await getYouTubeToken({ deps: env.deps, conns: env.conns, events: env.events, google: env.google, creatorId });
    const channel = await getMyChannel(env.deps, token);
    const today = isoDay(now);
    const points: PointRow[] = [];
    const current = (metric: string, value: number | null) => {
      if (value !== null) points.push({ platform: 'youtube', scope: 'account', external_id: channel.id, metric, kind: 'current', window_days: 0, day: today, value });
    };
    current('subscribers', channel.subscriberCount);
    if (channel.subscriberCount === null) summary.notes.push('This channel hides its subscriber count, so none is stored.');
    current('channel_views_total', channel.viewCount);
    current('video_count', channel.videoCount);

    try {
      const report = await queryAnalytics(env.deps, token, {
        startDate: isoDay(new Date(now.getTime() - 90 * DAY_MS)), endDate: isoDay(new Date(now.getTime() - DAY_MS)), metrics: YT_DAILY_METRICS, dimensions: ['day'], sort: 'day',
      });
      points.push(...youtubeDailyPoints(report, channel.id));
      if (report.rows.length === 0) summary.notes.push('YouTube Analytics returned no daily rows yet. New channels and new uploads can take a couple of days to appear.');
    } catch (err) {
      if (err instanceof IntegrationError && (err.kind === 'permission' || err.kind === 'invalid')) summary.notes.push(`YouTube Analytics was not available: ${err.userMessage}`);
      else throw err;
    }

    let videos: YouTubeVideo[] = [];
    if (channel.uploadsPlaylistId) {
      videos = (await listRecentUploads(env.deps, token, channel.uploadsPlaylistId, 25)).filter((v) => v.privacyStatus !== 'private');
    }
    for (const v of videos) {
      const media = (metric: string, value: number | null) => {
        if (value !== null) points.push({ platform: 'youtube', scope: 'media', external_id: v.id, metric, kind: 'lifetime', window_days: 0, day: today, value });
      };
      media('views', v.views); media('likes', v.likes); media('comments', v.comments);
    }
    summary.points = await env.analytics.upsertPoints(creatorId, dedupePoints(points));
    summary.posts = videos.length ? await env.analytics.upsertPosts(creatorId, videos.map(youtubePostRow)) : 0;
    await env.conns.update(creatorId, 'youtube', { lastSyncedAt: now });
    return { ...summary, ok: true };
  } catch (err) {
    return failure(summary, err);
  }
}

// ── Instagram ──────────────────────────────────────────────────────────────

export function instagramFormat(m: Pick<InstagramMedia, 'mediaType' | 'mediaProductType'>): string {
  if (m.mediaProductType === 'REELS') return 'Short video';
  if (m.mediaType === 'CAROUSEL_ALBUM') return 'Carousel';
  if (m.mediaType === 'IMAGE') return 'Image post';
  if (m.mediaType === 'VIDEO') return 'Short video';
  return 'Other';
}

export function instagramPostRow(m: InstagramMedia, insights: Record<string, number>): SyncedPostRow {
  return {
    platform: 'Instagram',
    format: instagramFormat(m),
    title: m.caption ? m.caption.slice(0, 80) : null,
    published_at: m.timestamp,
    views: insights.views ?? null,
    likes: insights.likes ?? m.likeCount,
    comments: insights.comments ?? m.commentsCount,
    shares: insights.shares ?? null,
    saves: insights.saved ?? null,
    external_id: m.id,
    external_url: m.permalink,
    source: 'instagram',
  };
}

export async function syncInstagram(env: Env, creatorId: string): Promise<SyncSummary> {
  const summary: SyncSummary = { platform: 'instagram', ok: false, points: 0, posts: 0, notes: [] };
  if (!env.meta) return { ...summary, error: 'Instagram is not configured on this deployment.' };
  try {
    const now = env.deps.now();
    let usage: MetaUsage | null = null;
    const creds = await getInstagramCreds({ deps: env.deps, conns: env.conns, events: env.events, meta: env.meta, creatorId, onUsage: (u) => { usage = u; } });
    const igId = creds.igUserId;
    const today = isoDay(now);
    const points: PointRow[] = [];
    const add = (scope: 'account' | 'media', externalId: string, metric: string, kind: PointRow['kind'], value: number | null, windowDays = 0, day = today) => {
      if (value !== null && Number.isFinite(value)) points.push({ platform: 'instagram', scope, external_id: externalId, metric, kind, window_days: windowDays, day, value });
    };

    const account = await getInstagramAccount(creds.ctx, creds.pageToken, igId);
    add('account', igId, 'followers', 'current', account.followersCount);
    add('account', igId, 'media_count', 'current', account.mediaCount);

    const until = Math.floor(now.getTime() / 1000);
    const since = until - 28 * 86_400;
    const series = await getAccountInsights(creds.ctx, creds.pageToken, igId, { metrics: IG_ACCOUNT_SERIES_METRICS, metricType: 'time_series', since, until });
    for (const v of series.values) for (const p of v.series) add('account', igId, v.name, 'daily', p.value, 0, p.day);
    const totals = usageShouldBackOff(usage) ? { values: [], skipped: [...IG_ACCOUNT_TOTAL_METRICS] } : await getAccountInsights(creds.ctx, creds.pageToken, igId, { metrics: IG_ACCOUNT_TOTAL_METRICS, metricType: 'total_value', since, until });
    for (const v of totals.values) add('account', igId, v.name, 'window', v.total, 28);
    const skipped = [...series.skipped, ...totals.skipped];
    if (skipped.length) summary.notes.push(`Instagram did not return: ${skipped.join(', ')}. Some account metrics need 100 or more followers.`);

    const media = (await listRecentMedia(creds.ctx, creds.pageToken, igId, 25)).filter((m) => m.mediaProductType !== 'STORY');
    const rows: SyncedPostRow[] = [];
    let insightCalls = 0;
    for (const m of media) {
      let insights: Record<string, number> = {};
      if (insightCalls < 12 && !usageShouldBackOff(usage)) {
        insightCalls += 1;
        const set = IG_MEDIA_METRICS[m.mediaProductType === 'REELS' ? 'REELS' : 'FEED'];
        insights = (await getMediaInsights(creds.ctx, creds.pageToken, m.id, set)).values;
        for (const [metric, value] of Object.entries(insights)) add('media', m.id, metric, 'lifetime', value);
      }
      rows.push(instagramPostRow(m, insights));
    }
    if (usageShouldBackOff(usage)) summary.notes.push('Meta asked apps to slow down, so some post insights were skipped this time.');
    summary.points = await env.analytics.upsertPoints(creatorId, dedupePoints(points));
    summary.posts = rows.length ? await env.analytics.upsertPosts(creatorId, rows) : 0;
    await env.conns.update(creatorId, 'instagram', { lastSyncedAt: now });
    return { ...summary, ok: true };
  } catch (err) {
    return failure(summary, err);
  }
}

function failure(summary: SyncSummary, err: unknown): SyncSummary {
  if (err instanceof NotConnectedError) return { ...summary, error: `${summary.platform === 'youtube' ? 'YouTube' : 'Instagram'} is not connected.` };
  if (err instanceof ReauthRequiredError) return { ...summary, error: `${summary.platform === 'youtube' ? 'YouTube' : 'Instagram'} needs to be reconnected.` };
  if (err instanceof IntegrationError) return { ...summary, error: err.userMessage };
  console.error('[sync] unexpected error', err instanceof Error ? err.name : typeof err);
  return { ...summary, error: 'The sync failed unexpectedly. Nothing was changed.' };
}

export async function syncCreator(env: Env, creatorId: string, platforms: Platform[]): Promise<SyncSummary[]> {
  const out: SyncSummary[] = [];
  for (const platform of platforms) out.push(platform === 'youtube' ? await syncYouTube(env, creatorId) : await syncInstagram(env, creatorId));
  return out;
}
