import type { GoogleClient } from './google';
import type { MetaApp } from './meta';
import type { QuotaConfig, QuotaStore } from './quota';
import type { ConnectionSecrets, ConnectionStatus, Deps, JobStatus, MediaAssetRow, Platform, PublishJob } from './types';

/**
 * The interfaces the integration logic depends on. The real implementations (Supabase, service role)
 * live in store.ts; tests supply in-memory fakes. Every method that touches creator data takes the
 * creator id explicitly and must scope its query by it.
 */

export type ConnectionPatch = {
  accessToken?: string | null;
  refreshToken?: string | null;
  pageToken?: string | null;
  accessTokenExpiresAt?: Date | null;
  status?: ConnectionStatus;
  lastError?: string | null;
  lastRefreshedAt?: Date;
  lastSyncedAt?: Date;
  meta?: Record<string, unknown>;
};

export interface ConnectionStore {
  get(creatorId: string, platform: Platform): Promise<ConnectionSecrets | null>;
  update(creatorId: string, platform: Platform, patch: ConnectionPatch): Promise<void>;
  /** Active connections whose access token expires before `beforeIso`, for the refresh job. */
  listRefreshCandidates(beforeIso: string): Promise<Array<{ creatorId: string; platform: Platform }>>;
  /** Every active connection, for the analytics sync job. */
  listActive(): Promise<Array<{ creatorId: string; platform: Platform }>>;
}

export interface EventSink {
  record(creatorId: string | null, platform: Platform | 'image' | null, type: string, detail: Record<string, unknown>): Promise<void>;
}

export type JobPatch = Partial<
  Pick<
    PublishJob,
    | 'status' | 'progress' | 'attempts' | 'next_attempt_at' | 'locked_until' | 'external_id' | 'external_url' | 'container_ids'
    | 'upload_session_uri' | 'upload_size' | 'upload_offset' | 'upload_mime' | 'last_error' | 'error_code' | 'published_at' | 'post_id'
  >
>;

export interface JobStore {
  get(creatorId: string, jobId: string): Promise<PublishJob | null>;
  /** Applies the patch only when the job is still in one of `onlyIfStatus`. Returns the new row, or null when the guard failed. */
  update(creatorId: string, jobId: string, patch: JobPatch, onlyIfStatus?: JobStatus[]): Promise<PublishJob | null>;
  /** Atomically takes a short lock on a job in one of `statuses`. Null when it is locked or not in those states. */
  claim(creatorId: string, jobId: string, now: Date, lockMs: number, statuses: JobStatus[]): Promise<PublishJob | null>;
  /** Approved Instagram jobs that are due, across creators, oldest first. */
  listDueInstagram(now: Date, limit: number): Promise<Array<{ id: string; creator_id: string }>>;
  /** Jobs whose server work was interrupted (uploading or processing for too long). */
  listStuck(now: Date, olderThanMs: number): Promise<PublishJob[]>;
}

export interface MediaStore {
  get(creatorId: string, ids: string[]): Promise<MediaAssetRow[]>;
  /** A short-lived URL Instagram can fetch. Only the server creates these. */
  signedUrl(row: MediaAssetRow, ttlSec: number): Promise<string>;
}

export type NewPost = {
  platform: 'YouTube' | 'Instagram';
  format: string;
  title: string | null;
  published_at: string;
  external_id: string;
  external_url: string | null;
  source: 'youtube' | 'instagram';
  idea_id: string | null;
};

export interface PostStore {
  /** Inserts (or finds) the posts row for a published job and returns its id. */
  createFromJob(creatorId: string, post: NewPost): Promise<string | null>;
  /** Moves the linked idea to "posted" unless it is already posted or measured. */
  markIdeaPosted(creatorId: string, ideaId: string): Promise<void>;
}

export type PointRow = {
  platform: Platform;
  scope: 'account' | 'media';
  external_id: string;
  metric: string;
  kind: 'daily' | 'window' | 'current' | 'lifetime';
  window_days: number;
  day: string;
  value: number;
};

export type SyncedPostRow = {
  platform: 'YouTube' | 'Instagram';
  format: string | null;
  title: string | null;
  published_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  external_id: string;
  external_url: string | null;
  source: 'youtube' | 'instagram';
};

export interface AnalyticsStore {
  upsertPoints(creatorId: string, rows: PointRow[]): Promise<number>;
  upsertPosts(creatorId: string, rows: SyncedPostRow[]): Promise<number>;
}

export type Env = {
  deps: Deps;
  conns: ConnectionStore;
  jobs: JobStore;
  media: MediaStore;
  posts: PostStore;
  analytics: AnalyticsStore;
  quota: QuotaStore;
  events: EventSink;
  google: GoogleClient | null;
  meta: MetaApp | null;
  quotaConfig: QuotaConfig;
};
