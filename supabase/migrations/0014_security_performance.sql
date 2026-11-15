-- 0014: cover foreign keys with indexes, make RLS auth calls evaluate once per query, add data retention.

-- 1. Indexes for foreign keys the advisor flagged (partial: only rows that have a value).
create index if not exists ad_creatives_media_asset_idx on public.ad_creatives (media_asset_id) where media_asset_id is not null;
create index if not exists ideas_adapted_from_idx on public.ideas (adapted_from) where adapted_from is not null;
create index if not exists publish_jobs_idea_idx on public.publish_jobs (idea_id) where idea_id is not null;
create index if not exists publish_jobs_post_idx on public.publish_jobs (post_id) where post_id is not null;

-- 2. RLS: (select auth.jwt()) is evaluated once per statement instead of once per row. Same rules as before.
alter policy creator_profile_delete on public.creator_profile using (user_id = ((select auth.jwt()) ->> 'sub'));
alter policy creator_profile_insert on public.creator_profile with check (user_id = ((select auth.jwt()) ->> 'sub'));
alter policy creator_profile_update on public.creator_profile using (user_id = ((select auth.jwt()) ->> 'sub')) with check (user_id = ((select auth.jwt()) ->> 'sub'));

alter policy agent_events_select on public.agent_events using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy agent_events_insert on public.agent_events with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy inquiries_select on public.inquiries using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy inquiries_delete on public.inquiries using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy inquiries_update on public.inquiries
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy deals_owner on public.deals
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
alter policy ideas_owner on public.ideas
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')) and (adapted_from is null or public.idea_owned_by(adapted_from, creator_id)));
alter policy posts_owner on public.posts
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (idea_id is null or exists (select 1 from public.ideas i where i.id = posts.idea_id and i.creator_id = posts.creator_id)));
alter policy revenue_entries_owner on public.revenue_entries
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and (deal_id is null or exists (select 1 from public.deals d where d.id = revenue_entries.deal_id and d.creator_id = revenue_entries.creator_id)));

-- 3. Retention: operational logs are not kept forever (less data stored, less data to protect).
-- Creator content (ideas, posts, deals, revenue, media) is never touched here.
create or replace function public.purge_old_rows()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare a int; b int; c int;
begin
  delete from public.api_usage where day < current_date - 60;           get diagnostics a = row_count;
  delete from public.integration_events where created_at < now() - interval '90 days'; get diagnostics b = row_count;
  delete from public.agent_events where created_at < now() - interval '180 days';      get diagnostics c = row_count;
  return jsonb_build_object('api_usage', a, 'integration_events', b, 'agent_events', c);
end $$;
revoke all on function public.purge_old_rows() from public, anon, authenticated;
grant execute on function public.purge_old_rows() to service_role;
