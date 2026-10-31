-- Integrations: YouTube and Instagram connections, publishing, analytics, media and ads.
-- Purely additive: it creates new tables and adds columns. It drops nothing.
--
-- Security model for this file (read before editing):
--   * OAuth tokens are encrypted by the application (AES-256-GCM) BEFORE they reach the database.
--     The *_enc columns only ever hold the envelope "v<key version>:<iv>:<tag>:<ciphertext>".
--     A CHECK constraint rejects anything else, so a plaintext token cannot be stored by mistake.
--   * The signed-in role (`authenticated`) is given column-level SELECT on social_connections that
--     leaves out every token column, and no write access at all. A stolen session token therefore
--     cannot read or replace a connection's credentials through the REST API. Tokens are read and
--     written only by server code using the service role, always scoped to one creator_id.
--   * Rows that must come from a platform API (analytics_points, api_usage, integration_events)
--     cannot be written by the signed-in role. Nothing the creator types can pose as platform data.
--   * publish_jobs cannot be marked published (or any in-flight state) by the signed-in role, and no
--     job can leave "draft" without approved_at: nothing is posted without an explicit approval.

-- ── social_connections ────────────────────────────────────────────────────
create table public.social_connections (
  id                       uuid primary key default gen_random_uuid(),
  creator_id               uuid not null references public.creator_profile (id) on delete cascade,
  platform                 text not null check (platform in ('youtube', 'instagram')),
  -- YouTube channel id, or Instagram professional account id.
  external_account_id      text not null check (char_length(external_account_id) between 1 and 128),
  display_name             text check (char_length(display_name) <= 200),
  username                 text check (char_length(username) <= 200),
  avatar_url               text check (char_length(avatar_url) <= 2000),
  scopes                   text[] not null default '{}',
  status                   text not null default 'active' check (status in ('active', 'needs_reauth', 'revoked')),
  last_error               text check (char_length(last_error) <= 500),
  -- Encrypted secrets. Instagram: access_token_enc = 60-day user token, page_token_enc = Page token.
  -- YouTube: access_token_enc = short-lived access token, refresh_token_enc = long-lived refresh token.
  access_token_enc         text check (access_token_enc ~ '^v[0-9]+:'),
  refresh_token_enc        text check (refresh_token_enc ~ '^v[0-9]+:'),
  page_token_enc           text check (page_token_enc ~ '^v[0-9]+:'),
  access_token_expires_at  timestamptz,
  -- Non-secret platform details (Facebook Page id and name, Facebook user id, Graph API version used).
  meta                     jsonb not null default '{}'::jsonb,
  connected_at             timestamptz not null default now(),
  last_refreshed_at        timestamptz,
  last_synced_at           timestamptz,
  updated_at               timestamptz not null default now(),
  constraint social_connections_meta_is_object check (jsonb_typeof(meta) = 'object'),
  constraint social_connections_one_per_platform unique (creator_id, platform)
);
-- One external account belongs to one creator; webhooks and deauthorize callbacks resolve through this.
create unique index social_connections_external_uidx on public.social_connections (platform, external_account_id);
create index social_connections_fb_user_idx on public.social_connections ((meta ->> 'fb_user_id')) where platform = 'instagram';

-- ── media_assets ──────────────────────────────────────────────────────────
create table public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creator_profile (id) on delete cascade,
  kind         text not null check (kind in ('image', 'video')),
  source       text not null check (source in ('upload', 'generated')),
  bucket       text not null default 'creator-media',
  -- <Clerk user id>/<file>. The first folder must be the owner's id (enforced by the policy below).
  storage_path text not null check (char_length(storage_path) between 3 and 500),
  mime_type    text not null check (char_length(mime_type) <= 100),
  bytes        bigint check (bytes >= 0),
  width        integer check (width > 0),
  height       integer check (height > 0),
  duration_s   numeric check (duration_s >= 0),
  label        text check (char_length(label) <= 200),
  -- Only for generated images: what was asked and which provider answered.
  prompt       text check (char_length(prompt) <= 4000),
  provider     text check (char_length(provider) <= 60),
  model        text check (char_length(model) <= 100),
  ai_generated boolean not null default false,
  created_at   timestamptz not null default now(),
  constraint media_assets_generated_is_labelled check (source <> 'generated' or ai_generated),
  constraint media_assets_path_unique unique (bucket, storage_path)
);
create index media_assets_creator_created_idx on public.media_assets (creator_id, created_at desc);

-- ── publish_jobs ──────────────────────────────────────────────────────────
-- One row per destination. Rows created together share a batch_id (one form, several destinations).
create table public.publish_jobs (
  id                 uuid primary key default gen_random_uuid(),
  creator_id         uuid not null references public.creator_profile (id) on delete cascade,
  batch_id           uuid not null default gen_random_uuid(),
  platform           text not null check (platform in ('youtube', 'instagram')),
  format             text not null check (format in ('video', 'short', 'reel', 'photo', 'carousel')),
  title              text check (char_length(title) <= 100),
  caption            text check (char_length(caption) <= 5000),
  tags               text[] not null default '{}',
  privacy            text not null default 'private' check (privacy in ('public', 'unlisted', 'private')),
  -- YouTube requires an answer. Null means "not answered yet" and blocks approval in the app.
  made_for_kids      boolean,
  scheduled_for      timestamptz,
  media_asset_ids    uuid[] not null default '{}',
  idea_id            uuid references public.ideas (id) on delete set null,
  post_id            uuid references public.posts (id) on delete set null,
  status             text not null default 'draft' check (status in (
                       'draft',               -- saved, not approved
                       'scheduled',           -- approved: waiting for the upload (YouTube) or for its time (Instagram)
                       'uploading',           -- bytes are moving to the platform
                       'processing',          -- the platform is processing the media
                       'platform_scheduled',  -- uploaded; the platform will publish it at scheduled_for
                       'published',
                       'failed',
                       'needs_review',        -- outcome uncertain; never retried automatically
                       'cancelled')),
  approved_at        timestamptz,
  progress           smallint not null default 0 check (progress between 0 and 100),
  attempts           smallint not null default 0,
  next_attempt_at    timestamptz,
  locked_until       timestamptz,
  external_id        text,
  external_url       text,
  container_ids      text[] not null default '{}',
  -- YouTube resumable upload. The session URI is a bearer capability, so the signed-in role cannot read it.
  upload_session_uri text,
  upload_size        bigint check (upload_size >= 0),
  upload_offset      bigint not null default 0 check (upload_offset >= 0),
  upload_mime        text,
  last_error         text check (char_length(last_error) <= 500),
  error_code         text check (char_length(error_code) <= 60),
  published_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint publish_jobs_format_matches_platform check (
    (platform = 'youtube' and format in ('video', 'short')) or
    (platform = 'instagram' and format in ('reel', 'photo', 'carousel'))),
  constraint publish_jobs_instagram_caption_limit check (platform <> 'instagram' or caption is null or char_length(caption) <= 2200),
  -- The invariant behind "nothing posts without approval".
  constraint publish_jobs_approval_required check (status in ('draft', 'cancelled') or approved_at is not null)
);
create index publish_jobs_creator_status_idx on public.publish_jobs (creator_id, status, created_at desc);
create index publish_jobs_batch_idx on public.publish_jobs (batch_id);
create index publish_jobs_due_idx on public.publish_jobs (next_attempt_at, scheduled_for)
  where platform = 'instagram' and status in ('scheduled', 'processing');

-- ── analytics_points ──────────────────────────────────────────────────────
-- Metrics exactly as a platform API returned them. Written only by the server.
create table public.analytics_points (
  id          bigint generated always as identity primary key,
  creator_id  uuid not null references public.creator_profile (id) on delete cascade,
  platform    text not null check (platform in ('youtube', 'instagram')),
  scope       text not null check (scope in ('account', 'media')),
  -- Channel id / Instagram account id for scope=account; video id / media id for scope=media.
  external_id text not null,
  metric      text not null check (char_length(metric) <= 80),
  -- daily: one value per day. window: total over window_days ending on `day`.
  -- current: a point-in-time value on `day` (subscriber count). lifetime: running total as of `day`.
  kind        text not null check (kind in ('daily', 'window', 'current', 'lifetime')),
  window_days smallint check (window_days > 0),
  day         date not null,
  value       numeric not null,
  fetched_at  timestamptz not null default now(),
  constraint analytics_points_window_has_length check (kind <> 'window' or window_days is not null)
);
create unique index analytics_points_key_uidx
  on public.analytics_points (creator_id, platform, scope, external_id, metric, kind, coalesce(window_days, 0), day);
create index analytics_points_lookup_idx on public.analytics_points (creator_id, platform, metric, kind, day desc);

-- ── api_usage (quota ledger) ──────────────────────────────────────────────
create table public.api_usage (
  creator_id uuid not null references public.creator_profile (id) on delete cascade,
  provider   text not null check (provider in ('youtube', 'instagram', 'image')),
  bucket     text not null check (char_length(bucket) <= 40),
  day        date not null,
  units      integer not null default 0 check (units >= 0),
  updated_at timestamptz not null default now(),
  primary key (creator_id, provider, bucket, day)
);

-- Atomic increment. Callable by the server (service role) only.
create or replace function public.bump_api_usage(p_creator uuid, p_provider text, p_bucket text, p_day date, p_units integer)
returns integer
language sql
security invoker
set search_path = ''
as $$
  insert into public.api_usage as u (creator_id, provider, bucket, day, units)
  values (p_creator, p_provider, p_bucket, p_day, greatest(p_units, 0))
  on conflict (creator_id, provider, bucket, day)
  do update set units = u.units + greatest(p_units, 0), updated_at = now()
  returning u.units;
$$;
revoke all on function public.bump_api_usage(uuid, text, text, date, integer) from public, anon, authenticated;
grant execute on function public.bump_api_usage(uuid, text, text, date, integer) to service_role;

-- ── integration_events (audit trail, webhooks) ────────────────────────────
create table public.integration_events (
  id         uuid primary key default gen_random_uuid(),
  -- Null when a webhook could not be matched to a creator.
  creator_id uuid references public.creator_profile (id) on delete cascade,
  platform   text check (platform in ('youtube', 'instagram', 'image')),
  type       text not null check (char_length(type) <= 60),
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint integration_events_detail_is_object check (jsonb_typeof(detail) = 'object'),
  -- Belt and braces: a credential must never be written into the log.
  constraint integration_events_no_secrets check (detail::text !~* '(access_token|refresh_token|client_secret|page_token)')
);
create index integration_events_creator_created_idx on public.integration_events (creator_id, created_at desc);

-- ── ad_creatives (drafts only: nothing here is ever submitted to an ads platform) ─
create table public.ad_creatives (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.creator_profile (id) on delete cascade,
  platform          text not null check (char_length(platform) between 1 and 40),
  objective         text check (char_length(objective) <= 200),
  offer             text check (char_length(offer) <= 1000),
  audience          text check (char_length(audience) <= 500),
  headline          text check (char_length(headline) <= 200),
  primary_text      text check (char_length(primary_text) <= 2200),
  description       text check (char_length(description) <= 500),
  cta               text check (char_length(cta) <= 60),
  variants          jsonb not null default '[]'::jsonb,
  media_asset_id    uuid references public.media_assets (id) on delete set null,
  status            text not null default 'draft' check (status in ('draft', 'approved', 'archived')),
  source_record_ids jsonb not null default '[]'::jsonb,
  ai_generated      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ad_creatives_variants_is_array check (jsonb_typeof(variants) = 'array'),
  constraint ad_creatives_source_ids_is_array check (jsonb_typeof(source_record_ids) = 'array')
);
create index ad_creatives_creator_created_idx on public.ad_creatives (creator_id, created_at desc);

-- ── posts: provenance for rows that came from a platform ──────────────────
alter table public.posts add column if not exists title text check (char_length(title) <= 200);
alter table public.posts add column if not exists external_id text;
alter table public.posts add column if not exists external_url text;
alter table public.posts add column if not exists source text not null default 'manual'
  check (source in ('manual', 'youtube', 'instagram'));
alter table public.posts add column if not exists metrics_synced_at timestamptz;
create unique index if not exists posts_external_uidx on public.posts (creator_id, platform, external_id) where external_id is not null;

-- ── triggers ──────────────────────────────────────────────────────────────
create trigger social_connections_set_updated_at before update on public.social_connections
  for each row execute function public.set_updated_at();
create trigger publish_jobs_set_updated_at before update on public.publish_jobs
  for each row execute function public.set_updated_at();
create trigger ad_creatives_set_updated_at before update on public.ad_creatives
  for each row execute function public.set_updated_at();

-- ── row-level security ────────────────────────────────────────────────────
alter table public.social_connections enable row level security;
alter table public.media_assets       enable row level security;
alter table public.publish_jobs       enable row level security;
alter table public.analytics_points   enable row level security;
alter table public.api_usage          enable row level security;
alter table public.integration_events enable row level security;
alter table public.ad_creatives       enable row level security;

revoke all on public.social_connections, public.media_assets, public.publish_jobs, public.analytics_points,
              public.api_usage, public.integration_events, public.ad_creatives from anon;
revoke all on public.social_connections, public.media_assets, public.publish_jobs, public.analytics_points,
              public.api_usage, public.integration_events, public.ad_creatives from authenticated;
-- The identity column's sequence is not reachable by the signed-in role either.
revoke all on sequence public.analytics_points_id_seq from anon, authenticated;

-- social_connections: read-only, and never the token columns.
grant select (id, creator_id, platform, external_account_id, display_name, username, avatar_url, scopes, status,
              last_error, access_token_expires_at, meta, connected_at, last_refreshed_at, last_synced_at, updated_at)
  on public.social_connections to authenticated;
create policy social_connections_select on public.social_connections
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

-- media_assets: the owner manages them; the file must sit in the owner's own storage folder.
grant select, insert, delete on public.media_assets to authenticated;
grant update (label) on public.media_assets to authenticated;
create policy media_assets_select on public.media_assets
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy media_assets_insert on public.media_assets
  for insert to authenticated
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and split_part(storage_path, '/', 1) = ((select auth.jwt()) ->> 'sub')
  );
create policy media_assets_update on public.media_assets
  for update to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy media_assets_delete on public.media_assets
  for delete to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

-- publish_jobs: the creator drafts, approves and cancels. Only the server moves a job into or through
-- uploading / processing / published / failed, so a job can never claim a result it did not get.
grant select (id, creator_id, batch_id, platform, format, title, caption, tags, privacy, made_for_kids, scheduled_for,
              media_asset_ids, idea_id, post_id, status, approved_at, progress, attempts, next_attempt_at, external_id,
              external_url, container_ids, upload_size, upload_offset, last_error, error_code, published_at,
              created_at, updated_at)
  on public.publish_jobs to authenticated;
-- Column-level writes: the creator can never set the platform-side columns (session URI, external id,
-- progress, attempts, errors). Those belong to the server.
grant insert (creator_id, batch_id, platform, format, title, caption, tags, privacy, made_for_kids, scheduled_for,
              media_asset_ids, idea_id, status, approved_at)
  on public.publish_jobs to authenticated;
grant update (title, caption, tags, privacy, made_for_kids, scheduled_for, media_asset_ids, idea_id, status, approved_at)
  on public.publish_jobs to authenticated;
grant delete on public.publish_jobs to authenticated;
create policy publish_jobs_select on public.publish_jobs
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy publish_jobs_insert on public.publish_jobs
  for insert to authenticated
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and status in ('draft', 'scheduled')
  );
create policy publish_jobs_update on public.publish_jobs
  for update to authenticated
  using (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and status in ('draft', 'scheduled', 'failed', 'cancelled')
  )
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and status in ('draft', 'scheduled', 'cancelled')
  );
create policy publish_jobs_delete on public.publish_jobs
  for delete to authenticated
  using (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and status in ('draft', 'cancelled', 'failed')
  );

-- analytics_points, api_usage, integration_events: read-only for the owner.
grant select on public.analytics_points, public.api_usage, public.integration_events to authenticated;
create policy analytics_points_select on public.analytics_points
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy api_usage_select on public.api_usage
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy integration_events_select on public.integration_events
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

-- ad_creatives: the owner manages them; a linked image must be the owner's own.
grant select, insert, update, delete on public.ad_creatives to authenticated;
create policy ad_creatives_owner on public.ad_creatives
  for all to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (
      media_asset_id is null
      or exists (select 1 from public.media_assets m where m.id = ad_creatives.media_asset_id and m.creator_id = ad_creatives.creator_id)
    )
  );

-- ── storage: private bucket for uploads and generated images ──────────────
-- Private on purpose: Instagram fetches media from a short-lived signed URL the server creates at publish time.
-- 50 MiB is the largest object Supabase accepts on the free plan; raise it here and in Storage settings on a paid plan.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-media', 'creator-media', false, 52428800,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy creator_media_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'creator-media' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
create policy creator_media_select on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-media' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
create policy creator_media_update on storage.objects
  for update to authenticated
  using (bucket_id = 'creator-media' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'))
  with check (bucket_id = 'creator-media' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
create policy creator_media_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'creator-media' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
