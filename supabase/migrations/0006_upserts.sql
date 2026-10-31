-- 0006_upserts.sql — server-side write paths for platform data.
--
-- Why SQL functions: PostgREST's upsert cannot target the expression index on analytics_points
-- (coalesce(window_days, 0)) or the partial unique index on posts (external_id is not null), so the
-- sync code calls these functions instead. They are callable by service_role only, which is the role
-- the server uses after it has already authenticated the creator; the browser's role cannot call them,
-- so platform numbers still cannot be typed in by hand.
--
-- Additive only: nothing here drops or rewrites an existing object.

-- ── analytics_points ──────────────────────────────────────────────────────
-- p_rows: [{platform, scope, external_id, metric, kind, window_days, day, value}, ...]
-- window_days 0 (or absent) means "not a window"; it is stored as NULL.
create or replace function public.upsert_analytics_points(p_creator uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'too many rows in one call (max 5000)' using errcode = '22023';
  end if;

  insert into public.analytics_points as a (creator_id, platform, scope, external_id, metric, kind, window_days, day, value, fetched_at)
  select p_creator, r.platform, r.scope, r.external_id, r.metric, r.kind, nullif(r.window_days, 0)::smallint, r.day, r.value, now()
  from jsonb_to_recordset(p_rows) as r(platform text, scope text, external_id text, metric text, kind text, window_days integer, day date, value numeric)
  on conflict (creator_id, platform, scope, external_id, metric, kind, (coalesce(window_days, 0)), day)
  do update set value = excluded.value, fetched_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── posts: metrics from a sync ────────────────────────────────────────────
-- Inserts posts that exist on the platform and refreshes the numbers of posts we already have.
-- Fields the creator may have edited by hand (format, title, notes, linked idea) are never overwritten;
-- they are filled in only when empty. A number the platform did not return never replaces a stored one.
-- p_rows: [{platform, format, title, published_at, views, likes, comments, shares, saves, external_id, external_url, source}, ...]
create or replace function public.upsert_synced_posts(p_creator uuid, p_rows jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'too many rows in one call (max 500)' using errcode = '22023';
  end if;

  insert into public.posts as p (creator_id, platform, format, title, published_at, views, likes, comments, shares, saves, external_id, external_url, source, metrics_synced_at)
  select p_creator, r.platform, r.format, left(r.title, 200), r.published_at, r.views, r.likes, r.comments, r.shares, r.saves, r.external_id, r.external_url, r.source, now()
  from jsonb_to_recordset(p_rows) as r(platform text, format text, title text, published_at timestamptz, views integer, likes integer, comments integer, shares integer, saves integer, external_id text, external_url text, source text)
  where r.external_id is not null and r.platform in ('YouTube', 'Instagram') and r.source in ('youtube', 'instagram')
  on conflict (creator_id, platform, external_id) where external_id is not null
  do update set
    views = coalesce(excluded.views, p.views),
    likes = coalesce(excluded.likes, p.likes),
    comments = coalesce(excluded.comments, p.comments),
    shares = coalesce(excluded.shares, p.shares),
    saves = coalesce(excluded.saves, p.saves),
    external_url = coalesce(excluded.external_url, p.external_url),
    published_at = coalesce(excluded.published_at, p.published_at),
    format = coalesce(p.format, excluded.format),
    title = coalesce(p.title, excluded.title),
    metrics_synced_at = now(),
    updated_at = now();

  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── posts: the row for something PBOS just published ──────────────────────
-- Insert-or-find, so a retried or resumed job can never create a second post. The linked idea is
-- attached only if it belongs to the same creator.
create or replace function public.create_post_from_job(p_creator uuid, p_row jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_idea uuid;
  v_id uuid;
begin
  if p_row is null or jsonb_typeof(p_row) <> 'object' then
    raise exception 'p_row must be a JSON object' using errcode = '22023';
  end if;
  if (p_row ->> 'platform') not in ('YouTube', 'Instagram') or (p_row ->> 'source') not in ('youtube', 'instagram') or coalesce(p_row ->> 'external_id', '') = '' then
    raise exception 'platform, source and external_id are required' using errcode = '22023';
  end if;

  select i.id into v_idea from public.ideas i
   where i.id = nullif(p_row ->> 'idea_id', '')::uuid and i.creator_id = p_creator;

  insert into public.posts as p (creator_id, idea_id, platform, format, title, published_at, external_id, external_url, source)
  values (
    p_creator, v_idea, p_row ->> 'platform', p_row ->> 'format', left(p_row ->> 'title', 200),
    (p_row ->> 'published_at')::timestamptz, p_row ->> 'external_id', p_row ->> 'external_url', p_row ->> 'source'
  )
  on conflict (creator_id, platform, external_id) where external_id is not null
  -- No-op update so RETURNING yields the existing row's id.
  do update set external_url = coalesce(excluded.external_url, p.external_url), idea_id = coalesce(p.idea_id, excluded.idea_id)
  returning p.id into v_id;

  return v_id;
end;
$$;

-- ── ideas: mark as posted ─────────────────────────────────────────────────
-- Moves an idea forward to "posted" only from the earlier stages; never backwards from measured.
create or replace function public.mark_idea_posted(p_creator uuid, p_idea uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  update public.ideas set status = 'posted', updated_at = now()
   where id = p_idea and creator_id = p_creator and status in ('idea', 'scripted', 'scheduled');
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- ── privileges: server only ───────────────────────────────────────────────
revoke all on function public.upsert_analytics_points(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_synced_posts(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.create_post_from_job(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mark_idea_posted(uuid, uuid) from public, anon, authenticated;
grant execute on function public.upsert_analytics_points(uuid, jsonb) to service_role;
grant execute on function public.upsert_synced_posts(uuid, jsonb) to service_role;
grant execute on function public.create_post_from_job(uuid, jsonb) to service_role;
grant execute on function public.mark_idea_posted(uuid, uuid) to service_role;
