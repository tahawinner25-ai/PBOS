import { IntegrationError } from './errors';
import { request, requestJson } from './http';
import type { Deps, Privacy } from './types';

/**
 * YouTube Data API v3 and YouTube Analytics API v2, as far as PBOS needs them.
 * Every function takes an access token and the injected `deps`; none of them stores or logs a token.
 */

const DATA_API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3/videos';
const ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';

/** Resumable upload chunks must be multiples of 256 KiB, except the final one (Google's protocol). */
export const CHUNK_QUANTUM = 256 * 1024;
export const YOUTUBE_TITLE_MAX = 100;
export const YOUTUBE_DESCRIPTION_MAX_BYTES = 5000;
export const YOUTUBE_TAGS_MAX_CHARS = 500;

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` });
const toNumber = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
};

// ── channel ────────────────────────────────────────────────────────────────

export type YouTubeChannel = {
  id: string;
  title: string;
  customUrl: string | null;
  thumbnailUrl: string | null;
  /** null when the channel hides its subscriber count */
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  uploadsPlaylistId: string | null;
};

type ChannelListResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; customUrl?: string; thumbnails?: Record<string, { url?: string }> };
    statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string; hiddenSubscriberCount?: boolean };
    contentDetails?: { relatedPlaylists?: { uploads?: string } };
  }>;
};

export async function getMyChannel(deps: Deps, token: string): Promise<YouTubeChannel> {
  const url = `${DATA_API}/channels?${new URLSearchParams({ part: 'snippet,statistics,contentDetails', mine: 'true' })}`;
  const body = await requestJson<ChannelListResponse>(deps, url, { headers: bearer(token) }, { platform: 'youtube' });
  const item = body.items?.[0];
  if (!item) {
    throw new IntegrationError({
      kind: 'invalid',
      platform: 'youtube',
      code: 'no_channel',
      userMessage: 'This Google account has no YouTube channel. Create one on YouTube, then connect again.',
    });
  }
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    id: item.id,
    title: item.snippet?.title ?? 'YouTube channel',
    customUrl: item.snippet?.customUrl ?? null,
    thumbnailUrl: thumbs.default?.url ?? thumbs.medium?.url ?? null,
    subscriberCount: item.statistics?.hiddenSubscriberCount ? null : toNumber(item.statistics?.subscriberCount),
    viewCount: toNumber(item.statistics?.viewCount),
    videoCount: toNumber(item.statistics?.videoCount),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

// ── upload ─────────────────────────────────────────────────────────────────

export type UploadMetadata = {
  title: string;
  description: string;
  tags: string[];
  privacy: Privacy;
  /** ISO time. When set, YouTube requires the video to be private until then. */
  publishAt: string | null;
  madeForKids: boolean;
  isShort: boolean;
};

/**
 * The videos.insert resource. YouTube has no "is a Short" field: a vertical (or square) video of up
 * to three minutes is a Short automatically, and `#Shorts` in the title or description is the
 * conventional hint, so we add it to the description when it is missing.
 */
export function buildVideoResource(meta: UploadMetadata): { snippet: Record<string, unknown>; status: Record<string, unknown> } {
  let description = meta.description;
  if (meta.isShort && !/#shorts\b/i.test(`${meta.title}\n${description}`)) description = `${description}${description ? '\n\n' : ''}#Shorts`;
  const scheduled = meta.publishAt !== null;
  return {
    snippet: { title: meta.title, description, tags: meta.tags, categoryId: '22' },
    status: {
      privacyStatus: scheduled ? 'private' : meta.privacy,
      ...(scheduled ? { publishAt: new Date(meta.publishAt as string).toISOString() } : {}),
      selfDeclaredMadeForKids: meta.madeForKids,
      embeddable: true,
    },
  };
}

/**
 * A resumable-session URI is a bearer capability: whoever holds it can write to the upload. We only
 * ever store and call URIs that Google issued, and refuse anything else, so a tampered database value
 * cannot turn the server into a proxy to an arbitrary host.
 */
export function assertGoogleUploadUri(uri: string): URL {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new IntegrationError({ kind: 'invalid', platform: 'youtube', code: 'bad_upload_uri', detail: 'upload session address is malformed' });
  }
  const hostOk = url.hostname === 'www.googleapis.com' || url.hostname.endsWith('.googleapis.com');
  if (url.protocol !== 'https:' || !hostOk || !url.pathname.startsWith('/upload/')) {
    throw new IntegrationError({ kind: 'invalid', platform: 'youtube', code: 'bad_upload_uri', detail: 'upload session address is not a Google upload address' });
  }
  return url;
}

export async function startResumableUpload(
  deps: Deps,
  token: string,
  args: { metadata: UploadMetadata; size: number; mime: string; notifySubscribers?: boolean },
): Promise<string> {
  if (!Number.isSafeInteger(args.size) || args.size <= 0) throw new IntegrationError({ kind: 'invalid', platform: 'youtube', code: 'bad_size', detail: 'file size must be positive' });
  const query = new URLSearchParams({ uploadType: 'resumable', part: 'snippet,status' });
  if (args.notifySubscribers === false) query.set('notifySubscribers', 'false');
  const res = await request(
    deps,
    `${UPLOAD_API}?${query}`,
    {
      method: 'POST',
      headers: {
        ...bearer(token),
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(args.size),
        'X-Upload-Content-Type': args.mime,
      },
      body: JSON.stringify(buildVideoResource(args.metadata)),
    },
    // Starting a session creates nothing visible; retrying a failed start is safe.
    { platform: 'youtube', maxAttempts: 3 },
  );
  const location = res.headers.get('location');
  if (!location) throw new IntegrationError({ kind: 'unknown', platform: 'youtube', status: res.status, detail: 'no upload session address returned' });
  assertGoogleUploadUri(location);
  return location;
}

export type YouTubeVideoResource = { id: string; status?: { privacyStatus?: string; uploadStatus?: string; publishAt?: string } };

export type UploadProgress =
  | { done: false; nextOffset: number }
  | { done: true; video: YouTubeVideoResource };

async function readProgress(res: Response): Promise<UploadProgress> {
  if (res.status === 308) {
    // "Range: bytes=0-N" means N+1 bytes are stored. No Range header means nothing is stored yet.
    const range = res.headers.get('range');
    const match = range ? /bytes=0-(\d+)/.exec(range) : null;
    return { done: false, nextOffset: match ? Number(match[1]) + 1 : 0 };
  }
  const video = (await res.json().catch(() => null)) as YouTubeVideoResource | null;
  if (!video || typeof video.id !== 'string') throw new IntegrationError({ kind: 'unknown', platform: 'youtube', status: res.status, detail: 'upload finished without a video resource' });
  return { done: true, video };
}

/**
 * Sends one chunk. `offset` is the byte position of the chunk's first byte in the whole file.
 * Retrying the same chunk is safe (the Content-Range makes it idempotent). The session URI authorises
 * the request, so no Authorization header is sent: an expired access token cannot break a long upload.
 */
export async function uploadChunk(
  deps: Deps,
  args: { sessionUri: string; chunk: Uint8Array; offset: number; total: number; mime: string },
): Promise<UploadProgress> {
  const { chunk, offset, total } = args;
  const end = offset + chunk.byteLength;
  if (chunk.byteLength === 0 || offset < 0 || end > total) throw new IntegrationError({ kind: 'invalid', platform: 'youtube', code: 'bad_chunk', detail: 'chunk range is outside the file' });
  if (end !== total && chunk.byteLength % CHUNK_QUANTUM !== 0) {
    throw new IntegrationError({ kind: 'invalid', platform: 'youtube', code: 'bad_chunk', detail: 'chunks must be a multiple of 256 KiB except the last one' });
  }
  const url = assertGoogleUploadUri(args.sessionUri).toString();
  const res = await request(
    deps,
    url,
    {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${total}`, 'Content-Type': args.mime },
      // Copy into an ArrayBuffer-backed view: fetch's BodyInit type does not accept SharedArrayBuffer-backed views.
      body: new Uint8Array(chunk),
    },
    { platform: 'youtube', maxAttempts: 3, okStatuses: [308], timeoutMs: 120_000 },
  );
  return readProgress(res);
}

/** Asks Google how many bytes it has, so a client can resume after a dropped connection. */
export async function queryUploadStatus(deps: Deps, args: { sessionUri: string; total: number }): Promise<UploadProgress> {
  const url = assertGoogleUploadUri(args.sessionUri).toString();
  const res = await request(
    deps,
    url,
    { method: 'PUT', headers: { 'Content-Length': '0', 'Content-Range': `bytes */${args.total}` } },
    { platform: 'youtube', maxAttempts: 3, okStatuses: [308] },
  );
  return readProgress(res);
}

// ── reading videos ─────────────────────────────────────────────────────────

export type YouTubeVideo = {
  id: string;
  title: string;
  publishedAt: string | null;
  privacyStatus: string | null;
  uploadStatus: string | null;
  publishAt: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  durationSeconds: number | null;
};

type VideoListResponse = {
  items?: Array<{
    id: string;
    snippet?: { title?: string; publishedAt?: string };
    status?: { privacyStatus?: string; uploadStatus?: string; publishAt?: string };
    statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    contentDetails?: { duration?: string };
  }>;
};

/** ISO 8601 duration (PT1H2M3S) to seconds. */
export function parseIsoDuration(value: string | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** videos.list costs one unit per call for up to 50 ids. */
export async function getVideos(deps: Deps, token: string, ids: string[]): Promise<YouTubeVideo[]> {
  const out: YouTubeVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = `${DATA_API}/videos?${new URLSearchParams({ part: 'snippet,statistics,status,contentDetails', id: batch.join(','), maxResults: '50' })}`;
    const body = await requestJson<VideoListResponse>(deps, url, { headers: bearer(token) }, { platform: 'youtube' });
    for (const item of body.items ?? []) {
      out.push({
        id: item.id,
        title: item.snippet?.title ?? '',
        publishedAt: item.snippet?.publishedAt ?? null,
        privacyStatus: item.status?.privacyStatus ?? null,
        uploadStatus: item.status?.uploadStatus ?? null,
        publishAt: item.status?.publishAt ?? null,
        views: toNumber(item.statistics?.viewCount),
        likes: toNumber(item.statistics?.likeCount),
        comments: toNumber(item.statistics?.commentCount),
        durationSeconds: parseIsoDuration(item.contentDetails?.duration),
      });
    }
  }
  return out;
}

type PlaylistItemsResponse = { items?: Array<{ contentDetails?: { videoId?: string } }> };

/** Latest uploads through the uploads playlist (1 unit per call; `search.list` would cost far more). */
export async function listRecentUploads(deps: Deps, token: string, uploadsPlaylistId: string, max = 25): Promise<YouTubeVideo[]> {
  const url = `${DATA_API}/playlistItems?${new URLSearchParams({ part: 'contentDetails', playlistId: uploadsPlaylistId, maxResults: String(Math.min(Math.max(max, 1), 50)) })}`;
  const body = await requestJson<PlaylistItemsResponse>(deps, url, { headers: bearer(token) }, { platform: 'youtube' });
  const ids = (body.items ?? []).map((item) => item.contentDetails?.videoId).filter((id): id is string => Boolean(id));
  return ids.length ? getVideos(deps, token, ids) : [];
}

// ── analytics ──────────────────────────────────────────────────────────────

export type AnalyticsReport = { headers: string[]; rows: Array<Array<string | number>> };

type AnalyticsResponse = { columnHeaders?: Array<{ name: string }>; rows?: Array<Array<string | number>> };

/**
 * YouTube Analytics API `reports.query` for the signed-in channel.
 * Metric names used by PBOS: views, estimatedMinutesWatched, averageViewDuration, subscribersGained,
 * subscribersLost, likes, comments, shares. Dimensions: day, video.
 */
export async function queryAnalytics(
  deps: Deps,
  token: string,
  args: { startDate: string; endDate: string; metrics: string[]; dimensions?: string[]; sort?: string; maxResults?: number; filters?: string },
): Promise<AnalyticsReport> {
  const params = new URLSearchParams({ ids: 'channel==MINE', startDate: args.startDate, endDate: args.endDate, metrics: args.metrics.join(',') });
  if (args.dimensions?.length) params.set('dimensions', args.dimensions.join(','));
  if (args.sort) params.set('sort', args.sort);
  if (args.maxResults) params.set('maxResults', String(args.maxResults));
  if (args.filters) params.set('filters', args.filters);
  const body = await requestJson<AnalyticsResponse>(deps, `${ANALYTICS_API}?${params}`, { headers: bearer(token) }, { platform: 'youtube' });
  return { headers: (body.columnHeaders ?? []).map((c) => c.name), rows: body.rows ?? [] };
}
