-- Row-level security. Every table is scoped to the authenticated creator, identified by the
-- Clerk user id in the session token (auth.jwt() ->> 'sub'). Supabase's Clerk integration adds
-- role = 'authenticated' to that token, so the policies below `to authenticated` apply to it.
-- The anon role gets no access at all; public pages read through the server
-- using the service role key, and only the whitelisted fields they render.

alter table public.creator_profile enable row level security;
alter table public.ideas           enable row level security;
alter table public.posts           enable row level security;
alter table public.deals           enable row level security;
alter table public.revenue_entries enable row level security;
alter table public.agent_events    enable row level security;
alter table public.inquiries       enable row level security;

-- Defense in depth: no table privileges for anon, minimal for authenticated.
revoke all on public.creator_profile, public.ideas, public.posts, public.deals,
              public.revenue_entries, public.agent_events, public.inquiries from anon;
revoke all on public.creator_profile, public.ideas, public.posts, public.deals,
              public.revenue_entries, public.agent_events, public.inquiries from authenticated;

grant select, insert, update, delete on public.creator_profile to authenticated;
grant select, insert, update, delete on public.ideas           to authenticated;
grant select, insert, update, delete on public.posts           to authenticated;
grant select, insert, update, delete on public.deals           to authenticated;
grant select, insert, update, delete on public.revenue_entries to authenticated;
grant select, insert                 on public.agent_events    to authenticated; -- append-only log
grant select, update, delete         on public.inquiries       to authenticated; -- inserts come from the server only

-- ── creator_profile: a user can only see and change their own profile ─────
create policy creator_profile_select on public.creator_profile
  for select to authenticated using (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_insert on public.creator_profile
  for insert to authenticated with check (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_update on public.creator_profile
  for update to authenticated
  using (user_id = ((select auth.jwt()) ->> 'sub')) with check (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_delete on public.creator_profile
  for delete to authenticated using (user_id = ((select auth.jwt()) ->> 'sub'));

-- A policy on ideas cannot query ideas directly (Postgres rejects the recursion), so the
-- "adapted_from must belong to the same creator" check goes through a tiny definer function.
-- It lives in a `private` schema that the REST API does not expose, so it cannot be called as
-- /rest/v1/rpc/...; policies still reach it because the signed-in role has USAGE and EXECUTE.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.idea_owned_by(p_idea uuid, p_creator uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.ideas i where i.id = p_idea and i.creator_id = p_creator);
$$;
revoke all on function private.idea_owned_by(uuid, uuid) from public, anon;
grant execute on function private.idea_owned_by(uuid, uuid) to authenticated;

-- ── child tables: rows belong to the creator who owns the parent profile ──
create policy ideas_owner on public.ideas
  for all to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (adapted_from is null or private.idea_owned_by(adapted_from, creator_id))
  );

create policy posts_owner on public.posts
  for all to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (
      idea_id is null
      or exists (select 1 from public.ideas i where i.id = posts.idea_id and i.creator_id = posts.creator_id)
    )
  );

create policy deals_owner on public.deals
  for all to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

create policy revenue_entries_owner on public.revenue_entries
  for all to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (
      deal_id is null
      or exists (select 1 from public.deals d where d.id = revenue_entries.deal_id and d.creator_id = revenue_entries.creator_id)
    )
  );

-- agent_events: read and append only. No update or delete policies exist.
create policy agent_events_select on public.agent_events
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy agent_events_insert on public.agent_events
  for insert to authenticated
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

-- inquiries: the owner reads and manages them. There is deliberately no insert
-- policy; the public contact form inserts through the server with the service role.
create policy inquiries_select on public.inquiries
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy inquiries_update on public.inquiries
  for update to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy inquiries_delete on public.inquiries
  for delete to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
