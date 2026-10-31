-- Tests for 0005_integrations.sql. Runs after 10_rls.test.sql on the same scratch database.
-- Uses its own two creators, C and D, so it does not depend on the earlier fixtures.
-- Any failed assertion aborts the run (ON_ERROR_STOP).

\set ON_ERROR_STOP on
\set QUIET on

-- ── helpers: run a statement as the CURRENT role and assert how it ends ───
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

create function tt.expect_rows(p_sql text, p_expected integer, p_label text) returns void
language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  assert n = p_expected, format('%s: expected %s affected rows, got %s', p_label, p_expected, n);
end $$;

-- ── fixtures (superuser) ──────────────────────────────────────────────────
insert into public.creator_profile (id, user_id, name) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', 'Creator C'),
  ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'user_2dDdDdDdDdDdDdDdDdDdDdDdDdD', 'Creator D');

insert into public.social_connections (id, creator_id, platform, external_account_id, access_token_enc, refresh_token_enc, page_token_enc, meta) values
  ('c0000000-0000-4000-8000-0000000000a1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube',   'UC_channel_c', 'v1:iv:tag:cipher', 'v1:iv:tag:refresh', null, '{}'),
  ('c0000000-0000-4000-8000-0000000000a2', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'instagram', 'ig_c',         'v1:iv:tag:cipher', null, 'v1:iv:tag:page', '{"fb_user_id":"fb_c"}'),
  ('d0000000-0000-4000-8000-0000000000a1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'youtube',   'UC_channel_d', 'v1:iv:tag:cipher', 'v1:iv:tag:refresh', null, '{}');

insert into public.media_assets (id, creator_id, kind, source, storage_path, mime_type, ai_generated) values
  ('c0000000-0000-4000-8000-0000000000b1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'image', 'upload', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/a.jpg', 'image/jpeg', false),
  ('d0000000-0000-4000-8000-0000000000b1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'image', 'upload', 'user_2dDdDdDdDdDdDdDdDdDdDdDdDdD/b.jpg', 'image/jpeg', false);

insert into public.publish_jobs (id, creator_id, platform, format, title, status, approved_at, upload_session_uri) values
  ('c0000000-0000-4000-8000-0000000000c1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'video', 'C draft', 'draft', null, null),
  ('c0000000-0000-4000-8000-0000000000c2', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'video', 'C uploading', 'uploading', now(), 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=secret'),
  ('c0000000-0000-4000-8000-0000000000c3', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'instagram', 'photo', 'C published', 'published', now(), null),
  ('d0000000-0000-4000-8000-0000000000c1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'youtube', 'video', 'D draft', 'draft', null, null);

insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, day, value) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'account', 'UC_channel_c', 'views', 'daily', '2026-10-01', 120),
  ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'youtube', 'account', 'UC_channel_d', 'views', 'daily', '2026-10-01', 999);

insert into public.integration_events (creator_id, platform, type, detail) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'connected', '{"channel":"UC_channel_c"}'),
  ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'youtube', 'connected', '{"channel":"UC_channel_d"}');

insert into public.ad_creatives (id, creator_id, platform, headline) values
  ('c0000000-0000-4000-8000-0000000000d1', 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Instagram', 'C ad'),
  ('d0000000-0000-4000-8000-0000000000d1', 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'Instagram', 'D ad');

-- ── 14. RLS on, no anon access of any kind ────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['social_connections','media_assets','publish_jobs','analytics_points','api_usage','integration_events','ad_creatives'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'RLS not enabled on ' || t;
    assert not has_table_privilege('anon', 'public.' || t, 'select'), 'anon can select ' || t;
    assert not has_table_privilege('anon', 'public.' || t, 'insert'), 'anon can insert ' || t;
  end loop;
  assert (select count(*) from pg_policies where schemaname in ('public','storage') and 'anon' = any (roles)) = 0, 'a policy targets anon';
  raise notice 'PASS 14: RLS enabled on the 7 new tables; anon has no privileges and no policies';
end $$;

-- ── 15. Creator C sees only C's rows ──────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  assert (select count(*) from public.social_connections) = 2, 'C should see its 2 connections';
  assert (select count(*) from public.media_assets) = 1, 'C should see its media asset';
  assert (select count(*) from public.publish_jobs) = 3, 'C should see its 3 jobs';
  assert (select count(*) from public.analytics_points) = 1, 'C should see its analytics point';
  assert (select count(*) from public.integration_events) = 1, 'C should see its event';
  assert (select count(*) from public.ad_creatives) = 1, 'C should see its ad';
  assert (select count(*) from public.publish_jobs where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'C can read D jobs';
  raise notice 'PASS 15: creator C sees only its own rows in the new tables';
end $$;
rollback;

-- ── 16. Token columns are unreadable and connections are read-only for the signed-in role ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  perform tt.expect_error('select access_token_enc from public.social_connections', '42501', 'read access token');
  perform tt.expect_error('select refresh_token_enc from public.social_connections', '42501', 'read refresh token');
  perform tt.expect_error('select page_token_enc from public.social_connections', '42501', 'read page token');
  perform tt.expect_error('select * from public.social_connections', '42501', 'select *');
  perform tt.expect_error('select upload_session_uri from public.publish_jobs', '42501', 'read upload session uri');
  perform tt.expect_error('select * from public.publish_jobs', '42501', 'select * on jobs');
  assert (select count(*) from (select id, platform, status, meta, access_token_expires_at from public.social_connections) s) = 2, 'safe columns readable';
  perform tt.expect_error($q$insert into public.social_connections (creator_id, platform, external_account_id) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','UC_x')$q$, '42501', 'insert connection');
  perform tt.expect_error($q$update public.social_connections set status = 'active'$q$, '42501', 'update connection');
  perform tt.expect_error($q$update public.social_connections set access_token_enc = 'v1:a:b:c'$q$, '42501', 'overwrite token');
  perform tt.expect_error('delete from public.social_connections', '42501', 'delete connection');
  raise notice 'PASS 16: token and session-URI columns are unreadable; connections are read-only for the signed-in role';
end $$;
rollback;

-- The server (service role) can read and write them.
begin;
set local role service_role;
do $$
begin
  assert (select access_token_enc from public.social_connections where id = 'c0000000-0000-4000-8000-0000000000a1') = 'v1:iv:tag:cipher', 'service role must read tokens';
  update public.social_connections set status = 'needs_reauth', last_error = 'test' where id = 'c0000000-0000-4000-8000-0000000000a1';
  assert (select status from public.social_connections where id = 'c0000000-0000-4000-8000-0000000000a1') = 'needs_reauth';
  raise notice 'PASS 16b: the service role can read and update connections';
end $$;
rollback;

-- ── 17. Only encrypted envelopes can be stored as tokens ──────────────────
do $$
begin
  perform tt.expect_error($q$update public.social_connections set access_token_enc = 'ya29.plaintext-google-token' where id = 'c0000000-0000-4000-8000-0000000000a1'$q$, '23514', 'plaintext google token');
  perform tt.expect_error($q$update public.social_connections set access_token_enc = 'EAAplaintextMetaToken' where id = 'c0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'plaintext meta token');
  perform tt.expect_error($q$update public.social_connections set refresh_token_enc = '1//plain-refresh' where id = 'c0000000-0000-4000-8000-0000000000a1'$q$, '23514', 'plaintext refresh token');
  perform tt.expect_error($q$update public.social_connections set page_token_enc = 'plain' where id = 'c0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'plaintext page token');
  update public.social_connections set access_token_enc = 'v2:iv:tag:cipher' where id = 'c0000000-0000-4000-8000-0000000000a1';
  update public.social_connections set access_token_enc = 'v1:iv:tag:cipher' where id = 'c0000000-0000-4000-8000-0000000000a1';
  raise notice 'PASS 17: plaintext tokens are rejected by a CHECK constraint; versioned envelopes are accepted';
end $$;

-- ── 18. publish_jobs: nothing leaves draft without approval; nothing claims a result ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
declare n integer;
begin
  -- A draft can be created.
  insert into public.publish_jobs (creator_id, platform, format, title) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'video', 'new draft');
  -- A scheduled job without approved_at is refused by the table constraint.
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format, status) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','photo','scheduled')$q$, '23514', 'scheduled without approval');
  -- With approval it is accepted.
  insert into public.publish_jobs (creator_id, platform, format, status, approved_at) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'instagram', 'photo', 'scheduled', now());
  -- A job cannot be created already published or in flight.
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format, status, approved_at) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','video','published', now())$q$, '42501', 'insert published');
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format, status, approved_at) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','video','uploading', now())$q$, '42501', 'insert uploading');
  -- Not into another creator's account.
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format) values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1','youtube','video')$q$, '42501', 'insert into other creator');
  -- Platform and format must match.
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','video')$q$, '23514', 'instagram video');
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','reel')$q$, '23514', 'youtube reel');
  -- Instagram captions stop at 2200 characters; YouTube titles at 100.
  perform tt.expect_error(format($q$insert into public.publish_jobs (creator_id, platform, format, caption) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','photo','%s')$q$, repeat('x', 2201)), '23514', 'long instagram caption');
  perform tt.expect_error(format($q$insert into public.publish_jobs (creator_id, platform, format, title) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','video','%s')$q$, repeat('x', 101)), '23514', 'long youtube title');
  -- Platform-side columns cannot be written by the creator.
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format, external_id) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','video','abc')$q$, '42501', 'insert external_id');
  perform tt.expect_error($q$insert into public.publish_jobs (creator_id, platform, format, upload_session_uri) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','video','https://evil.example/x')$q$, '42501', 'insert upload_session_uri');
  perform tt.expect_error($q$update public.publish_jobs set upload_session_uri = 'https://evil.example/x' where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'update upload_session_uri');
  perform tt.expect_error($q$update public.publish_jobs set external_id = 'x' where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'update external_id');
  perform tt.expect_error($q$update public.publish_jobs set progress = 100 where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'update progress');
  -- Approving a draft works; marking it published does not.
  perform tt.expect_rows($q$update public.publish_jobs set status = 'scheduled', approved_at = now() where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, 1, 'approve draft');
  perform tt.expect_error($q$update public.publish_jobs set status = 'published' where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'self-publish');
  perform tt.expect_error($q$update public.publish_jobs set status = 'uploading' where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '42501', 'self-upload');
  -- Jobs the server is working on cannot be edited; published jobs cannot be deleted.
  perform tt.expect_rows($q$update public.publish_jobs set title = 'tamper' where id = 'c0000000-0000-4000-8000-0000000000c2'$q$, 0, 'edit uploading job');
  perform tt.expect_rows($q$delete from public.publish_jobs where id = 'c0000000-0000-4000-8000-0000000000c3'$q$, 0, 'delete published job');
  perform tt.expect_rows($q$delete from public.publish_jobs where title = 'new draft'$q$, 1, 'delete own draft');
  -- Another creator's job is invisible to update and delete.
  perform tt.expect_rows($q$update public.publish_jobs set title = 'tamper' where id = 'd0000000-0000-4000-8000-0000000000c1'$q$, 0, 'update other creator job');
  perform tt.expect_rows($q$delete from public.publish_jobs where id = 'd0000000-0000-4000-8000-0000000000c1'$q$, 0, 'delete other creator job');
  raise notice 'PASS 18: approval is required, no self-published or in-flight states, platform columns are server-only, other creators are untouchable';
end $$;
rollback;

-- The server can drive the state machine; the approval invariant still holds for it.
begin;
set local role service_role;
do $$
begin
  update public.publish_jobs set status = 'uploading', progress = 40 where id = 'c0000000-0000-4000-8000-0000000000c2';
  update public.publish_jobs set status = 'published', external_id = 'vid123', published_at = now() where id = 'c0000000-0000-4000-8000-0000000000c2';
  perform tt.expect_error($q$update public.publish_jobs set status = 'published' where id = 'c0000000-0000-4000-8000-0000000000c1'$q$, '23514', 'server publishing an unapproved draft');
  raise notice 'PASS 18b: the server can advance approved jobs, but not a job that was never approved';
end $$;
rollback;

-- ── 19. analytics_points, api_usage, integration_events: platform data cannot be typed in ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  perform tt.expect_error($q$insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, day, value) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','account','UC_channel_c','views','daily','2026-10-02', 1000000)$q$, '42501', 'insert analytics');
  perform tt.expect_error($q$update public.analytics_points set value = 1000000$q$, '42501', 'update analytics');
  perform tt.expect_error($q$delete from public.analytics_points$q$, '42501', 'delete analytics');
  perform tt.expect_error($q$insert into public.api_usage (creator_id, provider, bucket, day, units) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','default','2026-10-02',1)$q$, '42501', 'insert api_usage');
  perform tt.expect_error($q$insert into public.integration_events (creator_id, type) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','forged')$q$, '42501', 'insert event');
  raise notice 'PASS 19: the signed-in role cannot write analytics, usage or the event log';
end $$;
rollback;

begin;
set local role service_role;
do $$
begin
  insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, day, value)
    values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','account','UC_channel_c','views','daily','2026-10-02', 130);
  -- The same data point twice is a unique violation, so the sync must upsert.
  perform tt.expect_error($q$insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, day, value) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','youtube','account','UC_channel_c','views','daily','2026-10-02', 131)$q$, '23505', 'duplicate point');
  -- A window total needs its length.
  perform tt.expect_error($q$insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, day, value) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','account','ig_c','reach','window','2026-10-02', 5)$q$, '23514', 'window without length');
  -- Two windows of different length on the same day may coexist.
  insert into public.analytics_points (creator_id, platform, scope, external_id, metric, kind, window_days, day, value) values
    ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','account','ig_c','reach','window', 7, '2026-10-02', 5),
    ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','instagram','account','ig_c','reach','window', 28, '2026-10-02', 20);
  -- Secrets are refused in the event log.
  perform tt.expect_error($q$insert into public.integration_events (creator_id, type, detail) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','token_refreshed','{"access_token":"ya29.x"}')$q$, '23514', 'secret in event');
  perform tt.expect_error($q$insert into public.integration_events (creator_id, type, detail) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','x','{"note":"contains a refresh_token value"}')$q$, '23514', 'secret-like text in event');
  insert into public.integration_events (creator_id, platform, type, detail) values (null, 'instagram', 'webhook', '{"unmatched":true}');
  raise notice 'PASS 19b: the server can write analytics (idempotently) and events; secrets are refused in the log';
end $$;
rollback;

-- ── 20. The quota counter is server-only and atomic ───────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  perform tt.expect_error($q$select public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', current_date, 1)$q$, '42501', 'authenticated bump');
end $$;
rollback;
begin;
set local role anon;
do $$
begin
  perform tt.expect_error($q$select public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', current_date, 1)$q$, '42501', 'anon bump');
end $$;
rollback;
begin;
set local role service_role;
do $$
begin
  assert public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', '2026-10-02', 3) = 3, 'first bump';
  assert public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', '2026-10-02', 2) = 5, 'second bump adds';
  assert public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'uploads', '2026-10-02', 1) = 1, 'separate bucket';
  assert public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', '2026-10-03', 1) = 1, 'separate day';
  assert public.bump_api_usage('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'youtube', 'default', '2026-10-02', -5) = 5, 'negative units never subtract';
  raise notice 'PASS 20: bump_api_usage is service-role only, additive, and per bucket and day';
end $$;
rollback;

-- ── 21. media_assets and the creator-media bucket ─────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  insert into public.media_assets (creator_id, kind, source, storage_path, mime_type)
    values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'video', 'upload', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/clip.mp4', 'video/mp4');
  -- A path in someone else's folder is refused, as is another creator_id.
  perform tt.expect_error($q$insert into public.media_assets (creator_id, kind, source, storage_path, mime_type) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','image','upload','user_2dDdDdDdDdDdDdDdDdDdDdDdDdD/x.jpg','image/jpeg')$q$, '42501', 'path in other folder');
  perform tt.expect_error($q$insert into public.media_assets (creator_id, kind, source, storage_path, mime_type) values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1','image','upload','user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/y.jpg','image/jpeg')$q$, '42501', 'other creator_id');
  -- Generated images must carry the AI label.
  perform tt.expect_error($q$insert into public.media_assets (creator_id, kind, source, storage_path, mime_type, ai_generated) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','image','generated','user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/g.jpg','image/jpeg', false)$q$, '23514', 'unlabelled generated image');
  insert into public.media_assets (creator_id, kind, source, storage_path, mime_type, ai_generated, prompt, provider)
    values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','image','generated','user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/g.jpg','image/jpeg', true, 'a desk', 'openai');
  -- Only the label may change.
  perform tt.expect_rows($q$update public.media_assets set label = 'cover' where id = 'c0000000-0000-4000-8000-0000000000b1'$q$, 1, 'relabel');
  perform tt.expect_error($q$update public.media_assets set storage_path = 'user_2dDdDdDdDdDdDdDdDdDdDdDdDdD/b.jpg' where id = 'c0000000-0000-4000-8000-0000000000b1'$q$, '42501', 'repoint storage_path');
  perform tt.expect_rows($q$update public.media_assets set label = 'x' where id = 'd0000000-0000-4000-8000-0000000000b1'$q$, 0, 'relabel other creator asset');
  -- Storage object policies: own folder only; the bucket is private with a size cap.
  assert (select public from storage.buckets where id = 'creator-media') = false, 'creator-media must be private';
  assert (select file_size_limit from storage.buckets where id = 'creator-media') > 0, 'creator-media needs a size limit';
  insert into storage.objects (bucket_id, name) values ('creator-media', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC/clip.mp4');
  perform tt.expect_error($q$insert into storage.objects (bucket_id, name) values ('creator-media', 'user_2dDdDdDdDdDdDdDdDdDdDdDdDdD/clip.mp4')$q$, '42501', 'object in other folder');
  raise notice 'PASS 21: media rows and storage objects are limited to the owner folder; generated images are labelled AI';
end $$;
rollback;

-- ── 22. ad_creatives cannot link another creator's media ──────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  insert into public.ad_creatives (creator_id, platform, headline, media_asset_id)
    values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Instagram', 'ok', 'c0000000-0000-4000-8000-0000000000b1');
  perform tt.expect_error($q$insert into public.ad_creatives (creator_id, platform, headline, media_asset_id) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','Instagram','steal','d0000000-0000-4000-8000-0000000000b1')$q$, '42501', 'link other creator media');
  perform tt.expect_rows($q$update public.ad_creatives set headline = 'x' where id = 'd0000000-0000-4000-8000-0000000000d1'$q$, 0, 'edit other creator ad');
  perform tt.expect_error($q$insert into public.ad_creatives (creator_id, platform, status) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','Instagram','submitted')$q$, '23514', 'ad status');
  raise notice 'PASS 22: ad drafts are private to their creator and cannot link foreign media';
end $$;
rollback;

-- ── 23. posts: platform provenance ────────────────────────────────────────
do $$
begin
  insert into public.posts (creator_id, platform, external_id, source) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'YouTube', 'vid1', 'youtube');
  perform tt.expect_error($q$insert into public.posts (creator_id, platform, external_id, source) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','YouTube','vid1','youtube')$q$, '23505', 'duplicate external post');
  -- The same external id on another platform or for another creator is fine.
  insert into public.posts (creator_id, platform, external_id, source) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'Instagram', 'vid1', 'instagram');
  insert into public.posts (creator_id, platform, external_id, source) values ('d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1', 'YouTube', 'vid1', 'youtube');
  -- Manual rows have no external id and may repeat.
  insert into public.posts (creator_id, platform) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'YouTube'), ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'YouTube');
  assert (select source from public.posts where creator_id = 'c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1' and external_id is null limit 1) = 'manual', 'default source is manual';
  perform tt.expect_error($q$insert into public.posts (creator_id, platform, source) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1','YouTube','tiktok')$q$, '23514', 'unknown source');
  raise notice 'PASS 23: synced posts are unique per platform id; manual posts default to source=manual';
end $$;

-- ── 24. Deleting a creator removes every new row too ──────────────────────
do $$
begin
  delete from public.creator_profile where id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
  assert (select count(*) from public.social_connections where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'connections not cascaded';
  assert (select count(*) from public.publish_jobs where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'jobs not cascaded';
  assert (select count(*) from public.analytics_points where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'analytics not cascaded';
  assert (select count(*) from public.media_assets where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'media not cascaded';
  assert (select count(*) from public.ad_creatives where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'ads not cascaded';
  assert (select count(*) from public.integration_events where creator_id = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1') = 0, 'events not cascaded';
  raise notice 'PASS 24: removing a creator cascades to connections, jobs, media, analytics, ads and events';
end $$;

drop schema tt cascade;
