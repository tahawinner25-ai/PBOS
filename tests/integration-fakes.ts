import type { AnalyticsStore, ConnectionPatch, ConnectionStore, Env, EventSink, JobPatch, JobStore, MediaStore, NewPost, PointRow, PostStore, SyncedPostRow } from '../src/lib/integrations/ports';
import { DEFAULT_QUOTA, type QuotaBucket, type QuotaStore } from '../src/lib/integrations/quota';
import type { ConnectionSecrets, Deps, JobStatus, MediaAssetRow, Platform, PublishJob } from '../src/lib/integrations/types';

/** In-memory stand-ins for the network, the clock and the database, so the real logic runs unchanged. */

export const CREATOR = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1';
export const START = Date.parse('2026-10-20T12:00:00Z');

export type Call = { url: string; method: string; headers: Record<string, string>; body: string | Uint8Array | null };

type Route = { test: (c: Call) => boolean; reply: (c: Call) => Response | Promise<Response>; once: boolean; used: number };

export class FakeNet {
  calls: Call[] = [];
  private routes: Route[] = [];

  on(test: (c: Call) => boolean, reply: (c: Call) => Response | Promise<Response>, opts: { once?: boolean } = {}): this {
    this.routes.push({ test, reply, once: opts.once ?? false, used: 0 });
    return this;
  }

  /** Routes by "METHOD substring-of-url". */
  route(spec: string, reply: (c: Call) => Response | Promise<Response>, opts: { once?: boolean } = {}): this {
    const [method, ...rest] = spec.split(' ');
    const needle = rest.join(' ');
    return this.on((c) => c.method === method && c.url.includes(needle), reply, opts);
  }

  fetch: typeof fetch = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
    const raw = init?.body ?? null;
    const body = raw === null ? null : typeof raw === 'string' ? raw : raw instanceof URLSearchParams ? raw.toString() : (raw as Uint8Array);
    const call: Call = { url: String(input), method: (init?.method ?? 'GET').toUpperCase(), headers, body };
    this.calls.push(call);
    const route = this.routes.find((r) => r.test(call) && (!r.once || r.used === 0));
    if (!route) throw new Error(`FakeNet: no route for ${call.method} ${call.url}`);
    route.used += 1;
    return route.reply(call);
  };

  count(needle: string, method?: string): number {
    return this.calls.filter((c) => c.url.includes(needle) && (!method || c.method === method)).length;
  }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
export const bare = (status: number, headers: Record<string, string> = {}) => new Response(null, { status, headers });
export const form = (c: Call): URLSearchParams => new URLSearchParams(typeof c.body === 'string' ? c.body : '');

export function makeDeps(net: FakeNet): Deps & { clock: { now: number }; sleeps: number[] } {
  const clock = { now: START };
  const sleeps: number[] = [];
  return {
    fetch: net.fetch,
    now: () => new Date(clock.now),
    sleep: async (ms) => { sleeps.push(ms); clock.now += ms; },
    random: () => 0.5,
    clock,
    sleeps,
  };
}

export class FakeConns implements ConnectionStore {
  rows = new Map<string, ConnectionSecrets>();
  key = (creatorId: string, platform: Platform) => `${creatorId}:${platform}`;
  put(c: Partial<ConnectionSecrets> & { platform: Platform }): ConnectionSecrets {
    const row: ConnectionSecrets = {
      id: `conn-${c.platform}`, creator_id: CREATOR, external_account_id: c.platform === 'youtube' ? 'UC_chan' : 'ig_1', status: 'active', scopes: [],
      accessToken: null, refreshToken: null, pageToken: null, accessTokenExpiresAt: null, meta: {}, ...c,
    };
    this.rows.set(this.key(row.creator_id, row.platform), row);
    return row;
  }
  async get(creatorId: string, platform: Platform) { return this.rows.get(this.key(creatorId, platform)) ?? null; }
  async update(creatorId: string, platform: Platform, patch: ConnectionPatch) {
    const row = this.rows.get(this.key(creatorId, platform));
    if (!row) return;
    if (patch.accessToken !== undefined) row.accessToken = patch.accessToken;
    if (patch.refreshToken !== undefined) row.refreshToken = patch.refreshToken;
    if (patch.pageToken !== undefined) row.pageToken = patch.pageToken;
    if (patch.accessTokenExpiresAt !== undefined) row.accessTokenExpiresAt = patch.accessTokenExpiresAt;
    if (patch.status) row.status = patch.status;
    if (patch.meta) row.meta = { ...row.meta, ...patch.meta };
    (row as ConnectionSecrets & { lastError?: string | null; lastSyncedAt?: Date }).lastError = patch.lastError ?? (row as { lastError?: string | null }).lastError;
    if (patch.lastSyncedAt) (row as ConnectionSecrets & { lastSyncedAt?: Date }).lastSyncedAt = patch.lastSyncedAt;
  }
  async listRefreshCandidates() { return [...this.rows.values()].map((r) => ({ creatorId: r.creator_id, platform: r.platform })); }
  async listActive() { return [...this.rows.values()].filter((r) => r.status === 'active').map((r) => ({ creatorId: r.creator_id, platform: r.platform })); }
}

export function makeJob(over: Partial<PublishJob> = {}): PublishJob {
  return {
    id: 'job-1', creator_id: CREATOR, batch_id: 'batch-1', platform: 'instagram', format: 'photo', title: null, caption: 'Hello', tags: [], privacy: 'public',
    made_for_kids: null, scheduled_for: null, media_asset_ids: ['m1'], idea_id: null, post_id: null, status: 'scheduled', approved_at: new Date(START - 60_000).toISOString(),
    progress: 0, attempts: 0, next_attempt_at: null, locked_until: null, external_id: null, external_url: null, container_ids: [], upload_session_uri: null,
    upload_size: null, upload_offset: 0, upload_mime: null, last_error: null, error_code: null, published_at: null,
    created_at: new Date(START - 3_600_000).toISOString(), updated_at: new Date(START - 3_600_000).toISOString(), ...over,
  };
}

export class FakeJobs implements JobStore {
  rows = new Map<string, PublishJob>();
  now = () => START;
  add(job: PublishJob) { this.rows.set(job.id, job); return job; }
  async get(creatorId: string, id: string) { const j = this.rows.get(id); return j && j.creator_id === creatorId ? { ...j } : null; }
  async update(creatorId: string, id: string, patch: JobPatch, onlyIfStatus?: JobStatus[]) {
    const j = this.rows.get(id);
    if (!j || j.creator_id !== creatorId) return null;
    if (onlyIfStatus && !onlyIfStatus.includes(j.status)) return null;
    Object.assign(j, patch);
    return { ...j };
  }
  async claim(creatorId: string, id: string, now: Date, lockMs: number, statuses: JobStatus[]) {
    const j = this.rows.get(id);
    if (!j || j.creator_id !== creatorId || !statuses.includes(j.status)) return null;
    if (j.locked_until && Date.parse(j.locked_until) > now.getTime()) return null;
    j.locked_until = new Date(now.getTime() + lockMs).toISOString();
    return { ...j };
  }
  async listDueInstagram(now: Date, limit: number) {
    return [...this.rows.values()]
      .filter((j) => j.platform === 'instagram' && ['scheduled', 'processing'].includes(j.status) && j.approved_at && (!j.next_attempt_at || Date.parse(j.next_attempt_at) <= now.getTime()))
      .slice(0, limit).map((j) => ({ id: j.id, creator_id: j.creator_id }));
  }
  async listStuck(now: Date, olderThanMs: number) {
    return [...this.rows.values()].filter((j) => ['uploading', 'processing'].includes(j.status) && now.getTime() - Date.parse(j.updated_at) > olderThanMs).map((j) => ({ ...j }));
  }
}

export class FakeMedia implements MediaStore {
  rows = new Map<string, MediaAssetRow>();
  add(row: Partial<MediaAssetRow> & { id: string }): MediaAssetRow {
    const full: MediaAssetRow = { creator_id: CREATOR, kind: 'image', source: 'upload', bucket: 'creator-media', storage_path: `user/${row.id}.jpg`, mime_type: 'image/jpeg', bytes: 1000, width: null, height: null, duration_s: null, label: null, ai_generated: false, ...row };
    this.rows.set(full.id, full);
    return full;
  }
  async get(creatorId: string, ids: string[]) { return ids.map((id) => this.rows.get(id)).filter((r): r is MediaAssetRow => Boolean(r && r.creator_id === creatorId)); }
  async signedUrl(row: MediaAssetRow, ttl: number) { return `https://signed.example/${row.storage_path}?ttl=${ttl}`; }
}

export class FakePosts implements PostStore {
  posts: Array<NewPost & { id: string }> = [];
  postedIdeas: string[] = [];
  async createFromJob(_creatorId: string, post: NewPost) {
    const existing = this.posts.find((p) => p.external_id === post.external_id && p.platform === post.platform);
    if (existing) return existing.id;
    const id = `post-${this.posts.length + 1}`;
    this.posts.push({ ...post, id });
    return id;
  }
  async markIdeaPosted(_creatorId: string, ideaId: string) { this.postedIdeas.push(ideaId); }
}

export class FakeAnalytics implements AnalyticsStore {
  points = new Map<string, PointRow>();
  posts = new Map<string, SyncedPostRow>();
  async upsertPoints(_creatorId: string, rows: PointRow[]) {
    for (const r of rows) this.points.set([r.platform, r.scope, r.external_id, r.metric, r.kind, r.window_days, r.day].join('|'), r);
    return rows.length;
  }
  async upsertPosts(_creatorId: string, rows: SyncedPostRow[]) {
    for (const r of rows) this.posts.set(`${r.platform}|${r.external_id}`, r);
    return rows.length;
  }
  find(metric: string, kind?: string) { return [...this.points.values()].filter((p) => p.metric === metric && (!kind || p.kind === kind)); }
}

export class FakeQuota implements QuotaStore {
  used_ = new Map<string, number>();
  private k = (c: string, p: Platform, b: QuotaBucket, d: string) => `${c}|${p}|${b}|${d}`;
  async used(c: string, p: Platform, b: QuotaBucket, d: string) { return this.used_.get(this.k(c, p, b, d)) ?? 0; }
  async bump(c: string, p: Platform, b: QuotaBucket, d: string, units: number) {
    const next = (this.used_.get(this.k(c, p, b, d)) ?? 0) + units;
    this.used_.set(this.k(c, p, b, d), next);
    return next;
  }
}

export class FakeEvents implements EventSink {
  list: Array<{ creatorId: string | null; platform: string | null; type: string; detail: Record<string, unknown> }> = [];
  async record(creatorId: string | null, platform: Platform | 'image' | null, type: string, detail: Record<string, unknown>) { this.list.push({ creatorId, platform, type, detail }); }
  types() { return this.list.map((e) => e.type); }
}

export function makeEnv(net: FakeNet = new FakeNet()) {
  const deps = makeDeps(net);
  const conns = new FakeConns();
  const jobs = new FakeJobs();
  const media = new FakeMedia();
  const posts = new FakePosts();
  const analytics = new FakeAnalytics();
  const quota = new FakeQuota();
  const events = new FakeEvents();
  const env: Env = {
    deps, conns, jobs, media, posts, analytics, quota, events,
    google: { clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://app.example/api/connect/youtube/callback' },
    meta: { appId: 'aid', appSecret: 'asecret', redirectUri: 'https://app.example/api/connect/instagram/callback', version: 'v26.0' },
    quotaConfig: DEFAULT_QUOTA,
  };
  return { env, net, deps, conns, jobs, media, posts, analytics, quota, events };
}

/** A string that must never appear in logs or errors in the tests below. */
export const SECRET_TOKEN = 'ya29.SECRET-ACCESS-TOKEN-1234567890';
