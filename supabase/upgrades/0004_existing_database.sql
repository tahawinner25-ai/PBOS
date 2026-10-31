-- One-off upgrade for a database that already ran the FIRST version of migrations 0001-0003
-- (policies written as `(select auth.jwt() ->> 'sub')`, helper function in the public schema).
-- A fresh install does NOT need this file: the current 0001-0003 already produce this end state.
--
-- What it changes:
--   * Policies use `((select auth.jwt()) ->> 'sub')`, the form Supabase's linter recognises as evaluated once per query.
--   * idea_owned_by moves from `public` to `private`, so it is no longer callable as /rest/v1/rpc/idea_owned_by.
--   * Adds an index on ideas.adapted_from.
-- It drops and recreates policies, so the Supabase tooling asks for confirmation. Nothing is lost: policies hold no data.
-- Safe to run twice.

drop policy if exists creator_profile_select on public.creator_profile;
drop policy if exists creator_profile_insert on public.creator_profile;
drop policy if exists creator_profile_update on public.creator_profile;
drop policy if exists creator_profile_delete on public.creator_profile;
drop policy if exists ideas_owner on public.ideas;
drop policy if exists posts_owner on public.posts;
drop policy if exists deals_owner on public.deals;
drop policy if exists revenue_entries_owner on public.revenue_entries;
drop policy if exists agent_events_select on public.agent_events;
drop policy if exists agent_events_insert on public.agent_events;
drop policy if exists inquiries_select on public.inquiries;
drop policy if exists inquiries_update on public.inquiries;
drop policy if exists inquiries_delete on public.inquiries;
drop policy if exists creator_assets_insert on storage.objects;
drop policy if exists creator_assets_update on storage.objects;
drop policy if exists creator_assets_delete on storage.objects;
drop policy if exists creator_assets_select_own on storage.objects;
drop function if exists public.idea_owned_by(uuid, uuid);
create index if not exists ideas_adapted_from_idx on public.ideas (adapted_from);

create policy creator_profile_select on public.creator_profile
  for select to authenticated using (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_insert on public.creator_profile
  for insert to authenticated with check (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_update on public.creator_profile
  for update to authenticated
  using (user_id = ((select auth.jwt()) ->> 'sub')) with check (user_id = ((select auth.jwt()) ->> 'sub'));
create policy creator_profile_delete on public.creator_profile
  for delete to authenticated using (user_id = ((select auth.jwt()) ->> 'sub'));

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

create policy agent_events_select on public.agent_events
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
create policy agent_events_insert on public.agent_events
  for insert to authenticated
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

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

create policy creator_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

create policy creator_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'))
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

create policy creator_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

create policy creator_assets_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
