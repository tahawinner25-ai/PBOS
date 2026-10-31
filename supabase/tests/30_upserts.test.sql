-- Tests for 0006_upserts.sql. Runs after 20_integrations.test.sql on the same scratch database.
-- Uses its own creators E and F.
\set ON_ERROR_STOP on
\set QUIET on

create schema tt;
grant usage on schema tt to public;
create function tt.expect_error(p_sql text, p_state text, p_label text) returns void
language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    assert sqlstate = p_state, format('%s: expected SQLSTATE %s but got %s (%s)', p_label, p_state, sqlstate, sqlerrm);
    return;
  end;
  raise exception '%: statement unexpectedly succeeded', p_label;
end $$;

insert into public.creator_profile (id, user_id, name) values
  ('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'user_2eEeEeEeEeEeEeEeEeEeEeEeEeE', 'Creator E'),
  ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'user_2fFfFfFfFfFfFfFfFfFfFfFfFfF', 'Creator F');
insert into public.ideas (id, creator_id, hook, status) values
  ('e0000000-0000-4000-8000-0000000000e1', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'E idea', 'scheduled'),
  ('e0000000-0000-4000-8000-0000000000e2', 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'E measured idea', 'measured'),
  ('f0000000-0000-4000-8000-0000000000f1', 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'F idea', 'scheduled');

-- ── 30. Only the server role can call the write functions ─────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2eEeEeEeEeEeEeEeEeEeEeEeEeE', true);
do $$
begin
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[]')$q$, '42501', 'authenticated upsert_analytics_points');
  perform tt.expect_error($q$select public.upsert_synced_posts('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[]')$q$, '42501', 'authenticated upsert_synced_posts');
  perform tt.expect_error($q$select public.create_post_from_job('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '{}')$q$, '42501', 'authenticated create_post_from_job');
  perform tt.expect_error($q$select public.mark_idea_posted('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', 'e0000000-0000-4000-8000-0000000000e1')$q$, '42501', 'authenticated mark_idea_posted');
end $$;
rollback;
begin;
set local role anon;
do $$
begin
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[]')$q$, '42501', 'anon upsert_analytics_points');
  perform tt.expect_error($q$select public.create_post_from_job('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '{}')$q$, '42501', 'anon create_post_from_job');
end $$;
rollback;
do $$ begin raise notice 'PASS 30: the platform-data write functions are service-role only'; end $$;

-- ── 31. analytics upsert: idempotent, window-aware, input-checked ─────────
begin;
set local role service_role;
do $$
declare
  c constant uuid := 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
  rows1 constant jsonb := '[
    {"platform":"youtube","scope":"account","external_id":"UC_e","metric":"views","kind":"daily","window_days":0,"day":"2026-10-01","value":10},
    {"platform":"youtube","scope":"account","external_id":"UC_e","metric":"views","kind":"daily","window_days":0,"day":"2026-10-02","value":20},
    {"platform":"instagram","scope":"account","external_id":"ig_e","metric":"views","kind":"window","window_days":28,"day":"2026-10-20","value":300},
    {"platform":"instagram","scope":"account","external_id":"ig_e","metric":"views","kind":"window","window_days":7,"day":"2026-10-20","value":70}
  ]';
begin
  assert public.upsert_analytics_points(c, rows1) = 4, 'first insert';
  assert (select count(*) from public.analytics_points where creator_id = c) = 4, 'four rows';
  -- Same keys again with new values: updated in place, not duplicated (this is the expression-index case).
  assert public.upsert_analytics_points(c, '[{"platform":"youtube","scope":"account","external_id":"UC_e","metric":"views","kind":"daily","window_days":0,"day":"2026-10-01","value":11}]') = 1, 'second pass touches 1';
  assert (select count(*) from public.analytics_points where creator_id = c) = 4, 'still four rows';
  assert (select value from public.analytics_points where creator_id = c and day = '2026-10-01') = 11, 'value updated';
  assert (select count(*) from public.analytics_points where creator_id = c and kind = 'window') = 2, 'windows of different length are different rows';
  assert (select window_days from public.analytics_points where creator_id = c and kind = 'daily' limit 1) is null, 'non-window rows store NULL window_days';
  -- Another creator is unaffected.
  perform public.upsert_analytics_points('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', '[{"platform":"youtube","scope":"account","external_id":"UC_e","metric":"views","kind":"daily","window_days":0,"day":"2026-10-01","value":999}]');
  assert (select value from public.analytics_points where creator_id = c and day = '2026-10-01') = 11, 'other creator did not overwrite';
  assert (select count(*) from public.analytics_points where creator_id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 1, 'one row for F';
end $$;
do $$
begin
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '{"not":"an array"}')$q$, '22023', 'object instead of array');
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[{"platform":"tiktok","scope":"account","external_id":"x","metric":"m","kind":"daily","window_days":0,"day":"2026-10-01","value":1}]')$q$, '23514', 'unknown platform');
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[{"platform":"youtube","scope":"account","external_id":"x","metric":"m","kind":"window","window_days":0,"day":"2026-10-01","value":1}]')$q$, '23514', 'window without length');
  perform tt.expect_error($q$select public.upsert_analytics_points('00000000-0000-4000-8000-000000000000', '[{"platform":"youtube","scope":"account","external_id":"x","metric":"m","kind":"daily","window_days":0,"day":"2026-10-01","value":1}]')$q$, '23503', 'unknown creator');
  perform tt.expect_error($q$select public.upsert_analytics_points('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', (select jsonb_agg('{"platform":"youtube","scope":"account","external_id":"x","metric":"m","kind":"daily","day":"2026-10-01","value":1}'::jsonb) from generate_series(1, 5001)))$q$, '22023', 'too many rows');
  raise notice 'PASS 31: analytics upsert is idempotent, keeps window lengths apart, and rejects bad input';
end $$;
rollback;

-- ── 32. posts: sync refreshes numbers but never overwrites the creator's edits or invents numbers ─
begin;
set local role service_role;
do $$
declare
  c constant uuid := 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
  p uuid;
begin
  -- A synced post that does not exist yet is inserted.
  assert public.upsert_synced_posts(c, '[{"platform":"YouTube","format":"Long video","title":"Synced title","published_at":"2026-10-01T10:00:00Z","views":100,"likes":10,"comments":null,"shares":null,"saves":null,"external_id":"vid1","external_url":"https://www.youtube.com/watch?v=vid1","source":"youtube"}]') = 1, 'insert';
  select id into p from public.posts where creator_id = c and external_id = 'vid1';
  assert (select source from public.posts where id = p) = 'youtube', 'source recorded';
  assert (select metrics_synced_at from public.posts where id = p) is not null, 'sync time recorded';
  assert (select comments from public.posts where id = p) is null, 'a number the platform did not return stays NULL, not zero';
  -- The creator edits format and title and links notes.
  update public.posts set format = 'Short video', title = 'My own title', notes = 'keep me' where id = p;
  -- A later sync with new numbers (and a missing one).
  perform public.upsert_synced_posts(c, '[{"platform":"YouTube","format":"Long video","title":"Synced title","published_at":"2026-10-01T10:00:00Z","views":150,"likes":null,"comments":4,"shares":null,"saves":null,"external_id":"vid1","external_url":null,"source":"youtube"}]');
  assert (select count(*) from public.posts where creator_id = c and external_id = 'vid1') = 1, 'no duplicate post';
  assert (select views from public.posts where id = p) = 150, 'views refreshed';
  assert (select likes from public.posts where id = p) = 10, 'a metric missing from the sync does not erase the stored value';
  assert (select comments from public.posts where id = p) = 4, 'new metric stored';
  assert (select format from public.posts where id = p) = 'Short video', 'edited format kept';
  assert (select title from public.posts where id = p) = 'My own title', 'edited title kept';
  assert (select notes from public.posts where id = p) = 'keep me', 'notes kept';
  assert (select external_url from public.posts where id = p) = 'https://www.youtube.com/watch?v=vid1', 'url kept when the sync has none';
  -- Rows that are not platform posts are ignored instead of stored.
  assert public.upsert_synced_posts(c, '[{"platform":"TikTok","external_id":"t1","source":"youtube"},{"platform":"YouTube","external_id":null,"source":"youtube"},{"platform":"YouTube","external_id":"vid2","source":"manual"}]') = 0, 'invalid rows skipped';
  -- The same external id for another creator is a different post.
  perform public.upsert_synced_posts('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', '[{"platform":"YouTube","title":"F post","views":5,"external_id":"vid1","source":"youtube"}]');
  assert (select views from public.posts where id = p) = 150, 'other creator cannot touch E''s post';
  assert (select count(*) from public.posts where external_id = 'vid1' and creator_id in (c, 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1')) = 2, 'one per creator';
  -- Long titles are cut to the column limit instead of failing the whole sync.
  perform public.upsert_synced_posts(c, jsonb_build_array(jsonb_build_object('platform','Instagram','title',repeat('x', 500),'external_id','ig9','source','instagram')));
  assert (select char_length(title) from public.posts where creator_id = c and external_id = 'ig9') = 200, 'title truncated';
  raise notice 'PASS 32: sync refreshes metrics, keeps the creator''s edits, never fabricates a number, and is per-creator';
end $$;
rollback;

-- ── 33. posts from a publish job: insert-or-find, idea ownership, idea progress ─
begin;
set local role service_role;
do $$
declare
  c constant uuid := 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1';
  a uuid; b uuid; x uuid;
begin
  a := public.create_post_from_job(c, '{"platform":"YouTube","format":"Long video","title":"T","published_at":"2026-10-20T12:00:00Z","external_id":"vidA","external_url":"https://www.youtube.com/watch?v=vidA","source":"youtube","idea_id":"e0000000-0000-4000-8000-0000000000e1"}');
  assert a is not null, 'id returned';
  b := public.create_post_from_job(c, '{"platform":"YouTube","format":"Long video","title":"T","published_at":"2026-10-20T12:00:00Z","external_id":"vidA","source":"youtube"}');
  assert a = b, 'a retried job gets the same post, not a second one';
  assert (select count(*) from public.posts where creator_id = c and external_id = 'vidA') = 1, 'one row';
  assert (select idea_id from public.posts where id = a) = 'e0000000-0000-4000-8000-0000000000e1', 'idea link survives the retry';
  -- Another creator's idea cannot be linked.
  x := public.create_post_from_job(c, '{"platform":"Instagram","external_id":"igB","source":"instagram","idea_id":"f0000000-0000-4000-8000-0000000000f1"}');
  assert (select idea_id from public.posts where id = x) is null, 'foreign idea silently not linked';
  perform tt.expect_error($q$select public.create_post_from_job('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '{"platform":"TikTok","external_id":"z","source":"youtube"}')$q$, '22023', 'bad platform');
  perform tt.expect_error($q$select public.create_post_from_job('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '{"platform":"YouTube","source":"youtube"}')$q$, '22023', 'missing external id');
  perform tt.expect_error($q$select public.create_post_from_job('e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1', '[]')$q$, '22023', 'not an object');

  assert public.mark_idea_posted(c, 'e0000000-0000-4000-8000-0000000000e1') = true, 'scheduled idea moves to posted';
  assert (select status from public.ideas where id = 'e0000000-0000-4000-8000-0000000000e1') = 'posted', 'status posted';
  assert public.mark_idea_posted(c, 'e0000000-0000-4000-8000-0000000000e1') = false, 'already posted: no change';
  assert public.mark_idea_posted(c, 'e0000000-0000-4000-8000-0000000000e2') = false, 'measured never moves back';
  assert (select status from public.ideas where id = 'e0000000-0000-4000-8000-0000000000e2') = 'measured', 'still measured';
  assert public.mark_idea_posted(c, 'f0000000-0000-4000-8000-0000000000f1') = false, 'another creator''s idea is untouched';
  assert (select status from public.ideas where id = 'f0000000-0000-4000-8000-0000000000f1') = 'scheduled', 'F idea unchanged';
  raise notice 'PASS 33: job posts are insert-or-find, ideas are linked only within the creator, progress never goes backwards';
end $$;
rollback;

drop schema tt cascade;
