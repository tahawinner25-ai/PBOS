import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { TokenCryptoError, decryptToken, encryptToken, tokenAad, type Keyring } from './crypto';
import type { AnalyticsStore, ConnectionPatch, ConnectionStore, EventSink, JobPatch, JobStore, MediaStore, NewPost, PointRow, PostStore, SyncedPostRow } from './ports';
import type { QuotaBucket, QuotaStore } from './quota';
import type { ConnectionSecrets, ConnectionStatus, JobStatus, MediaAssetRow, Platform, PublishJob } from './types';

/**
 * Supabase implementations of the integration ports. Used with the SERVICE-ROLE client, which
 * bypasses row-level security, so every query here filters by creator_id explicitly. Callers must
 * already have authenticated the creator (a signed-in session, or a cron job holding CRON_SECRET).
 *
 * Tokens are encrypted before they are written and decrypted only inside `get()`, bound to
 * creator + platform + column through the AAD (see crypto.ts).
 */

type Db = SupabaseClient;

function check<T>(label: string, res: { data: T | null; error: { message: string; code?: string } | null }): T | null {
  if (res.error) {
    // Log the code and our label only: never the row, which can hold encrypted token envelopes.
    console.error(`[integrations:store] ${label}: ${res.error.code ?? ''} ${res.error.message}`);
    throw new Error(`database error in ${label}`);
  }
  return res.data;
}

const TOKEN_COLUMNS = { access: 'access_token', refresh: 'refresh_token', page: 'page_token' } as const;

// ── connections ────────────────────────────────────────────────────────────

type ConnectionRow = {
  id: string; creator_id: string; platform: Platform; external_account_id: string; status: ConnectionStatus; scopes: string[] | null;
  access_token_enc: string | null; refresh_token_enc: string | null; page_token_enc: string | null; access_token_expires_at: string | null;
  meta: Record<string, unknown> | null;
};

export class SupabaseConnectionStore implements ConnectionStore {
  constructor(private readonly db: Db, private readonly ring: Keyring) {}

  private open(row: ConnectionRow, column: keyof typeof TOKEN_COLUMNS, value: string | null): string | null {
    if (!value) return null;
    try {
      return decryptToken(value, this.ring, tokenAad(row.creator_id, row.platform, TOKEN_COLUMNS[column]));
    } catch (err) {
      // A key that no longer matches (lost or rotated away) behaves like a missing token: the flow asks the creator to reconnect.
      if (err instanceof TokenCryptoError) {
        console.error(`[integrations:store] cannot decrypt ${row.platform} ${column} token (${err.code}); the connection will ask to be reconnected`);
        return null;
      }
      throw err;
    }
  }

  async get(creatorId: string, platform: Platform): Promise<ConnectionSecrets | null> {
    const row = check<ConnectionRow>('connections.get', await this.db.from('social_connections').select('*').eq('creator_id', creatorId).eq('platform', platform).maybeSingle());
    if (!row) return null;
    return {
      id: row.id, creator_id: row.creator_id, platform: row.platform, external_account_id: row.external_account_id, status: row.status, scopes: row.scopes ?? [],
      accessToken: this.open(row, 'access', row.access_token_enc),
      refreshToken: this.open(row, 'refresh', row.refresh_token_enc),
      pageToken: this.open(row, 'page', row.page_token_enc),
      accessTokenExpiresAt: row.access_token_expires_at ? new Date(row.access_token_expires_at) : null,
      meta: row.meta ?? {},
    };
  }

  async update(creatorId: string, platform: Platform, patch: ConnectionPatch): Promise<void> {
    const seal = (column: keyof typeof TOKEN_COLUMNS, value: string | null | undefined) =>
      value === undefined ? undefined : value === null ? null : encryptToken(value, this.ring, tokenAad(creatorId, platform, TOKEN_COLUMNS[column]));
    const set: Record<string, unknown> = {};
    const put = (key: string, value: unknown) => { if (value !== undefined) set[key] = value; };
    put('access_token_enc', seal('access', patch.accessToken));
    put('refresh_token_enc', seal('refresh', patch.refreshToken));
    put('page_token_enc', seal('page', patch.pageToken));
    put('access_token_expires_at', patch.accessTokenExpiresAt === undefined ? undefined : patch.accessTokenExpiresAt?.toISOString() ?? null);
    put('status', patch.status);
    put('last_error', patch.lastError === undefined ? undefined : patch.lastError?.slice(0, 500) ?? null);
    put('last_refreshed_at', patch.lastRefreshedAt?.toISOString());
    put('last_synced_at', patch.lastSyncedAt?.toISOString());
    if (patch.meta) {
      const current = check<{ meta: Record<string, unknown> | null }>('connections.meta', await this.db.from('social_connections').select('meta').eq('creator_id', creatorId).eq('platform', platform).maybeSingle());
      put('meta', { ...(current?.meta ?? {}), ...patch.meta });
    }
    if (Object.keys(set).length === 0) return;
    check('connections.update', await this.db.from('social_connections').update(set).eq('creator_id', creatorId).eq('platform', platform));
  }

  async listRefreshCandidates(beforeIso: string) {
    const rows = check<Array<{ creator_id: string; platform: Platform }>>('connections.refresh', await this.db
      .from('social_connections').select('creator_id, platform').eq('status', 'active').or(`access_token_expires_at.is.null,access_token_expires_at.lt.${beforeIso}`).limit(500));
    return (rows ?? []).map((r) => ({ creatorId: r.creator_id, platform: r.platform }));
  }

  async listActive() {
    const rows = check<Array<{ creator_id: string; platform: Platform }>>('connections.active', await this.db.from('social_connections').select('creator_id, platform').eq('status', 'active').limit(500));
    return (rows ?? []).map((r) => ({ creatorId: r.creator_id, platform: r.platform }));
  }
}

export type NewConnection = {
  creatorId: string;
  platform: Platform;
  externalAccountId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
  scopes: string[];
  accessToken: string;
  refreshToken?: string | null;
  pageToken?: string | null;
  accessTokenExpiresAt: Date | null;
  meta: Record<string, unknown>;
};

export class AccountAlreadyLinkedError extends Error {
  constructor() {
    super('That account is already connected to another PBOS user.');
    this.name = 'AccountAlreadyLinkedError';
  }
}

/** Creates or replaces the creator's connection for a platform (used by the OAuth callbacks). */
export async function saveConnection(db: Db, ring: Keyring, c: NewConnection): Promise<void> {
  const seal = (column: keyof typeof TOKEN_COLUMNS, value: string | null | undefined) =>
    value ? encryptToken(value, ring, tokenAad(c.creatorId, c.platform, TOKEN_COLUMNS[column])) : null;
  const row = {
    creator_id: c.creatorId,
    platform: c.platform,
    external_account_id: c.externalAccountId,
    display_name: c.displayName?.slice(0, 200) ?? null,
    username: c.username?.slice(0, 200) ?? null,
    avatar_url: c.avatarUrl && c.avatarUrl.length <= 2000 ? c.avatarUrl : null,
    scopes: c.scopes,
    status: 'active' as const,
    last_error: null,
    access_token_enc: seal('access', c.accessToken),
    // A reconnect without a new refresh token keeps the old one only for the same account; otherwise it is cleared.
    ...(c.refreshToken !== undefined ? { refresh_token_enc: seal('refresh', c.refreshToken) } : {}),
    ...(c.pageToken !== undefined ? { page_token_enc: seal('page', c.pageToken) } : {}),
    access_token_expires_at: c.accessTokenExpiresAt?.toISOString() ?? null,
    meta: c.meta,
    last_refreshed_at: new Date().toISOString(),
  };
  const res = await db.from('social_connections').upsert(row, { onConflict: 'creator_id,platform' });
  if (res.error) {
    if (res.error.code === '23505') throw new AccountAlreadyLinkedError();
    console.error(`[integrations:store] connections.save: ${res.error.code ?? ''} ${res.error.message}`);
    throw new Error('database error in connections.save');
  }
}

/** Removes a connection and its stored tokens. Returns the secrets it held so the caller can revoke them at the platform first. */
export async function deleteConnection(db: Db, creatorId: string, platform: Platform): Promise<void> {
  check('connections.delete', await db.from('social_connections').delete().eq('creator_id', creatorId).eq('platform', platform));
}

/** Resolves a Facebook user id (from a deauthorize / data-deletion callback) to the connections it owns. */
export async function findInstagramByFacebookUser(db: Db, fbUserId: string): Promise<Array<{ creatorId: string }>> {
  const rows = check<Array<{ creator_id: string }>>('connections.byFbUser', await db.from('social_connections').select('creator_id').eq('platform', 'instagram').eq('meta->>fb_user_id', fbUserId));
  return (rows ?? []).map((r) => ({ creatorId: r.creator_id }));
}

/** Resolves an Instagram account id (from a webhook) to its creator. */
export async function findCreatorByExternalAccount(db: Db, platform: Platform, externalAccountId: string): Promise<string | null> {
  const row = check<{ creator_id: string }>('connections.byAccount', await db.from('social_connections').select('creator_id').eq('platform', platform).eq('external_account_id', externalAccountId).maybeSingle());
  return row?.creator_id ?? null;
}

// ── publish jobs ───────────────────────────────────────────────────────────

export class SupabaseJobStore implements JobStore {
  constructor(private readonly db: Db) {}

  async get(creatorId: string, jobId: string): Promise<PublishJob | null> {
    return check<PublishJob>('jobs.get', await this.db.from('publish_jobs').select('*').eq('creator_id', creatorId).eq('id', jobId).maybeSingle());
  }

  async update(creatorId: string, jobId: string, patch: JobPatch, onlyIfStatus?: JobStatus[]): Promise<PublishJob | null> {
    let q = this.db.from('publish_jobs').update(patch).eq('creator_id', creatorId).eq('id', jobId);
    if (onlyIfStatus) q = q.in('status', onlyIfStatus);
    return check<PublishJob>('jobs.update', await q.select('*').maybeSingle());
  }

  /** One UPDATE decides the winner, so two workers can never both hold the lock. */
  async claim(creatorId: string, jobId: string, now: Date, lockMs: number, statuses: JobStatus[]): Promise<PublishJob | null> {
    return check<PublishJob>('jobs.claim', await this.db.from('publish_jobs')
      .update({ locked_until: new Date(now.getTime() + lockMs).toISOString() })
      .eq('creator_id', creatorId).eq('id', jobId).in('status', statuses)
      .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
      .select('*').maybeSingle());
  }

  async listDueInstagram(now: Date, limit: number) {
    const rows = check<Array<{ id: string; creator_id: string; scheduled_for: string | null; next_attempt_at: string | null; locked_until: string | null }>>('jobs.due', await this.db
      .from('publish_jobs').select('id, creator_id, scheduled_for, next_attempt_at, locked_until')
      .eq('platform', 'instagram').in('status', ['scheduled', 'processing']).not('approved_at', 'is', null)
      .order('created_at', { ascending: true }).limit(200));
    const t = now.getTime();
    return (rows ?? [])
      .filter((r) => (!r.scheduled_for || Date.parse(r.scheduled_for) <= t) && (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= t) && (!r.locked_until || Date.parse(r.locked_until) <= t))
      .slice(0, limit).map((r) => ({ id: r.id, creator_id: r.creator_id }));
  }

  async listStuck(now: Date, olderThanMs: number): Promise<PublishJob[]> {
    const cutoff = new Date(now.getTime() - olderThanMs).toISOString();
    return check<PublishJob[]>('jobs.stuck', await this.db.from('publish_jobs').select('*').in('status', ['uploading', 'processing']).lt('updated_at', cutoff).limit(100)) ?? [];
  }
}

// ── media ──────────────────────────────────────────────────────────────────

export class SupabaseMediaStore implements MediaStore {
  constructor(private readonly db: Db) {}

  async get(creatorId: string, ids: string[]): Promise<MediaAssetRow[]> {
    if (ids.length === 0) return [];
    return check<MediaAssetRow[]>('media.get', await this.db.from('media_assets').select('*').eq('creator_id', creatorId).in('id', ids)) ?? [];
  }

  async signedUrl(row: MediaAssetRow, ttlSec: number): Promise<string> {
    const res = await this.db.storage.from(row.bucket).createSignedUrl(row.storage_path, ttlSec);
    if (res.error || !res.data?.signedUrl) {
      console.error('[integrations:store] media.signedUrl failed');
      throw new Error('could not sign the media URL');
    }
    return res.data.signedUrl;
  }
}

// ── posts, analytics, quota, events ────────────────────────────────────────

export class SupabasePostStore implements PostStore {
  constructor(private readonly db: Db) {}
  async createFromJob(creatorId: string, post: NewPost): Promise<string | null> {
    const res = await this.db.rpc('create_post_from_job', { p_creator: creatorId, p_row: post });
    return (check<string>('posts.createFromJob', res) as string | null) ?? null;
  }
  async markIdeaPosted(creatorId: string, ideaId: string): Promise<void> {
    check('posts.markIdeaPosted', await this.db.rpc('mark_idea_posted', { p_creator: creatorId, p_idea: ideaId }));
  }
}

const chunks = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

export class SupabaseAnalyticsStore implements AnalyticsStore {
  constructor(private readonly db: Db) {}
  async upsertPoints(creatorId: string, rows: PointRow[]): Promise<number> {
    let n = 0;
    for (const part of chunks(rows, 1000)) n += (check<number>('analytics.points', await this.db.rpc('upsert_analytics_points', { p_creator: creatorId, p_rows: part })) as number | null) ?? 0;
    return n;
  }
  async upsertPosts(creatorId: string, rows: SyncedPostRow[]): Promise<number> {
    let n = 0;
    for (const part of chunks(rows, 200)) n += (check<number>('analytics.posts', await this.db.rpc('upsert_synced_posts', { p_creator: creatorId, p_rows: part })) as number | null) ?? 0;
    return n;
  }
}

export class SupabaseQuotaStore implements QuotaStore {
  constructor(private readonly db: Db) {}
  async used(creatorId: string, provider: Platform, bucket: QuotaBucket, day: string): Promise<number> {
    const row = check<{ units: number }>('quota.used', await this.db.from('api_usage').select('units').eq('creator_id', creatorId).eq('provider', provider).eq('bucket', bucket).eq('day', day).maybeSingle());
    return row?.units ?? 0;
  }
  async bump(creatorId: string, provider: Platform, bucket: QuotaBucket, day: string, units: number): Promise<number> {
    return (check<number>('quota.bump', await this.db.rpc('bump_api_usage', { p_creator: creatorId, p_provider: provider, p_bucket: bucket, p_day: day, p_units: units })) as number | null) ?? 0;
  }
}

export class SupabaseEventSink implements EventSink {
  constructor(private readonly db: Db) {}
  async record(creatorId: string | null, platform: Platform | 'image' | null, type: string, detail: Record<string, unknown>): Promise<void> {
    // The event log must never break the operation it describes.
    try {
      const res = await this.db.from('integration_events').insert({ creator_id: creatorId, platform, type: type.slice(0, 60), detail });
      if (res.error) console.error(`[integrations:store] events.record: ${res.error.code ?? ''}`);
    } catch {
      console.error('[integrations:store] events.record threw');
    }
  }
}

// ── deletion (disconnect, Meta deauthorize / data-deletion callbacks) ─────

/** Removes everything PBOS holds that came from Instagram for one creator: the connection and tokens, synced numbers, synced posts and Instagram publish jobs. Ideas and the creator's own entries stay. */
export async function deleteInstagramData(db: Db, creatorId: string): Promise<void> {
  check('deletion.connection', await db.from('social_connections').delete().eq('creator_id', creatorId).eq('platform', 'instagram'));
  check('deletion.points', await db.from('analytics_points').delete().eq('creator_id', creatorId).eq('platform', 'instagram'));
  check('deletion.posts', await db.from('posts').delete().eq('creator_id', creatorId).eq('source', 'instagram'));
  check('deletion.jobs', await db.from('publish_jobs').delete().eq('creator_id', creatorId).eq('platform', 'instagram'));
}

/** Same for YouTube (used by an explicit "disconnect and delete my YouTube data" request). */
export async function deleteYouTubeData(db: Db, creatorId: string): Promise<void> {
  check('deletion.connection', await db.from('social_connections').delete().eq('creator_id', creatorId).eq('platform', 'youtube'));
  check('deletion.points', await db.from('analytics_points').delete().eq('creator_id', creatorId).eq('platform', 'youtube'));
  check('deletion.posts', await db.from('posts').delete().eq('creator_id', creatorId).eq('source', 'youtube'));
  check('deletion.jobs', await db.from('publish_jobs').delete().eq('creator_id', creatorId).eq('platform', 'youtube'));
}
