/** Shared types for the YouTube and Instagram integrations. No runtime code here. */

export const PLATFORMS = ['youtube', 'instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const isPlatform = (value: unknown): value is Platform => PLATFORMS.includes(value as Platform);

/** Display names used in the `posts.platform` column (matches the app-wide PLATFORMS list). */
export const PLATFORM_LABEL: Record<Platform, 'YouTube' | 'Instagram'> = { youtube: 'YouTube', instagram: 'Instagram' };

export type JobFormat = 'video' | 'short' | 'reel' | 'photo' | 'carousel';
export type Privacy = 'public' | 'unlisted' | 'private';

export type JobStatus =
  | 'draft'
  | 'scheduled'
  | 'uploading'
  | 'processing'
  | 'platform_scheduled'
  | 'published'
  | 'failed'
  | 'needs_review'
  | 'cancelled';

export type ConnectionStatus = 'active' | 'needs_reauth' | 'revoked';

/** A publish job as the server sees it (includes server-only columns such as the upload session URI). */
export type PublishJob = {
  id: string;
  creator_id: string;
  batch_id: string;
  platform: Platform;
  format: JobFormat;
  title: string | null;
  caption: string | null;
  tags: string[];
  privacy: Privacy;
  made_for_kids: boolean | null;
  scheduled_for: string | null;
  media_asset_ids: string[];
  idea_id: string | null;
  post_id: string | null;
  status: JobStatus;
  approved_at: string | null;
  progress: number;
  attempts: number;
  next_attempt_at: string | null;
  locked_until: string | null;
  external_id: string | null;
  external_url: string | null;
  container_ids: string[];
  upload_session_uri: string | null;
  upload_size: number | null;
  upload_offset: number;
  upload_mime: string | null;
  last_error: string | null;
  error_code: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MediaAssetRow = {
  id: string;
  creator_id: string;
  kind: 'image' | 'video';
  source: 'upload' | 'generated';
  bucket: string;
  storage_path: string;
  mime_type: string;
  bytes: number | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  label: string | null;
  ai_generated: boolean;
};

/** Decrypted credentials. Exists only in server memory for the length of one operation. */
export type ConnectionSecrets = {
  id: string;
  creator_id: string;
  platform: Platform;
  external_account_id: string;
  status: ConnectionStatus;
  scopes: string[];
  accessToken: string | null;
  refreshToken: string | null;
  pageToken: string | null;
  accessTokenExpiresAt: Date | null;
  meta: Record<string, unknown>;
};

/** What the browser is allowed to know about a connection. Never contains a token. */
export type PublicConnection = {
  id: string;
  platform: Platform;
  external_account_id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  scopes: string[];
  status: ConnectionStatus;
  last_error: string | null;
  access_token_expires_at: string | null;
  meta: Record<string, unknown>;
  connected_at: string;
  last_refreshed_at: string | null;
  last_synced_at: string | null;
};

/** Injected so every network and time dependency can be replaced in tests. */
export type Deps = {
  fetch: typeof fetch;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
};

export const realDeps = (): Deps => ({
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
});
