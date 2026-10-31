-- RLS and constraint tests. Any failed assertion aborts the run (ON_ERROR_STOP).
-- Two creators, A and B, each own one of every record type.

\set ON_ERROR_STOP on
\set QUIET on

-- ── fixtures (superuser) ──────────────────────────────────────────────────
-- Clerk user ids are plain strings. There is no auth.users table to seed.

insert into public.creator_profile (id, user_id, name) values
  ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', 'Creator A'),
  ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'user_2bBbBbBbBbBbBbBbBbBbBbBbBbB', 'Creator B');

insert into public.ideas (id, creator_id, hook) values
  ('a0000000-0000-4000-8000-000000000001', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'A idea 1'),
  ('a0000000-0000-4000-8000-000000000002', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'A idea 2'),
  ('b0000000-0000-4000-8000-000000000001', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'B idea 1');
insert into public.posts (id, creator_id, idea_id, platform) values
  ('a0000000-0000-4000-8000-0000000000a1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a0000000-0000-4000-8000-000000000001', 'Instagram'),
  ('b0000000-0000-4000-8000-0000000000a1', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'b0000000-0000-4000-8000-000000000001', 'TikTok');
insert into public.deals (id, creator_id, brand) values
  ('a0000000-0000-4000-8000-0000000000d1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'A brand'),
  ('b0000000-0000-4000-8000-0000000000d1', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'B brand');
insert into public.revenue_entries (id, creator_id, deal_id, amount) values
  ('a0000000-0000-4000-8000-0000000000e1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a0000000-0000-4000-8000-0000000000d1', 100),
  ('b0000000-0000-4000-8000-0000000000e1', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'b0000000-0000-4000-8000-0000000000d1', 200);
insert into public.agent_events (id, creator_id, type, pillar) values
  ('a0000000-0000-4000-8000-0000000000f1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'flag', 'Analytics'),
  ('b0000000-0000-4000-8000-0000000000f1', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'flag', 'Revenue');
insert into public.inquiries (id, creator_id, name, email, message) values
  ('a0000000-0000-4000-8000-0000000000c1', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Lead A', 'lead@a.example', 'hello'),
  ('b0000000-0000-4000-8000-0000000000c1', 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'Lead B', 'lead@b.example', 'hello');

-- ── 1. RLS is enabled everywhere and no policy targets anon ───────────────
do $$
declare t text;
begin
  foreach t in array array['creator_profile','ideas','posts','deals','revenue_entries','agent_events','inquiries'] loop
    assert (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass), 'RLS not enabled on ' || t;
  end loop;
  assert (select count(*) from pg_policies where schemaname in ('public','storage') and 'anon' = any (roles)) = 0, 'a policy targets anon';
  raise notice 'PASS 1: RLS enabled on all 7 tables; no anon policies';
end $$;

-- ── 2. Creator A sees only A's data ───────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', true);
do $$
begin
  assert (select count(*) from public.creator_profile) = 1, 'A should see exactly its own profile';
  assert (select count(*) from public.ideas) = 2, 'A should see only its 2 ideas';
  assert (select count(*) from public.posts) = 1, 'A should see only its post';
  assert (select count(*) from public.deals) = 1, 'A should see only its deal';
  assert (select count(*) from public.revenue_entries) = 1, 'A should see only its revenue entry';
  assert (select count(*) from public.agent_events) = 1, 'A should see only its event';
  assert (select count(*) from public.inquiries) = 1, 'A should see only its inquiry';
  assert (select count(*) from public.ideas where creator_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1') = 0, 'A can read B ideas';
  raise notice 'PASS 2: creator A sees only its own rows in all 7 tables';
end $$;
rollback;

-- ── 3. Creator A cannot write into B's account ────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', true);
do $$
declare n int;
begin
  begin
    insert into public.ideas (creator_id, hook) values ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sneaky');
    raise exception 'RLS FAILURE: A inserted an idea into B';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.deals (creator_id, brand) values ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'sneaky');
    raise exception 'RLS FAILURE: A inserted a deal into B';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.creator_profile (user_id, name) values ('user_2bBbBbBbBbBbBbBbBbBbBbBbBbB', 'impostor');
    raise exception 'RLS FAILURE: A created a profile for B';
  exception when insufficient_privilege then null; end;

  update public.ideas set hook = 'hijacked' where id = 'b0000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  assert n = 0, 'A updated a B idea';

  delete from public.deals where id = 'b0000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  assert n = 0, 'A deleted a B deal';

  -- Moving A's own row to B must be rejected by WITH CHECK.
  begin
    update public.ideas set creator_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1' where id = 'a0000000-0000-4000-8000-000000000001';
    raise exception 'RLS FAILURE: A moved its idea to B';
  exception when insufficient_privilege then null; end;

  raise notice 'PASS 3: creator A cannot insert, update, delete or reassign rows in B';
end $$;
rollback;

-- ── 4. Cross-tenant foreign keys are blocked ──────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', true);
do $$
begin
  begin
    insert into public.posts (creator_id, idea_id) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'b0000000-0000-4000-8000-000000000001');
    raise exception 'RLS FAILURE: A linked a post to B idea';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.revenue_entries (creator_id, deal_id, amount) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'b0000000-0000-4000-8000-0000000000d1', 1);
    raise exception 'RLS FAILURE: A linked an invoice to B deal';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.ideas (creator_id, hook, adapted_from) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'x', 'b0000000-0000-4000-8000-000000000001');
    raise exception 'RLS FAILURE: A adapted B idea';
  exception when insufficient_privilege then null; end;

  -- Same-tenant links still work.
  insert into public.posts (creator_id, idea_id) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a0000000-0000-4000-8000-000000000001');
  insert into public.revenue_entries (creator_id, deal_id, amount) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'a0000000-0000-4000-8000-0000000000d1', 1);
  insert into public.ideas (creator_id, hook, adapted_from) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'adapted', 'a0000000-0000-4000-8000-000000000001');
  raise notice 'PASS 4: cross-tenant idea/deal links rejected, same-tenant links allowed';
end $$;
rollback;

-- ── 5. agent_events is append-only; inquiries cannot be inserted by users ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', true);
do $$
declare n int;
begin
  insert into public.agent_events (creator_id, type, pillar, payload) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'accepted', 'Analytics', '{"key":"posts_unmeasured"}');

  begin
    insert into public.agent_events (creator_id, type) values ('b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1', 'flag');
    raise exception 'RLS FAILURE: A wrote an event into B';
  exception when insufficient_privilege then null; end;

  begin
    update public.agent_events set type = 'ignored' where id = 'a0000000-0000-4000-8000-0000000000f1';
    raise exception 'RLS FAILURE: events are updatable';
  exception when insufficient_privilege then null; end;

  begin
    delete from public.agent_events where id = 'a0000000-0000-4000-8000-0000000000f1';
    raise exception 'RLS FAILURE: events are deletable';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.inquiries (creator_id, name, email, message) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'x', 'x@x.example', 'x');
    raise exception 'RLS FAILURE: user inserted an inquiry directly';
  exception when insufficient_privilege then null; end;

  update public.inquiries set status = 'read' where id = 'a0000000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  assert n = 1, 'owner should be able to update own inquiry status';
  raise notice 'PASS 5: agent_events append-only; inquiries read/update by owner only';
end $$;
rollback;

-- ── 6. The server (service_role) can insert inquiries; anon has no access ─
begin;
set local role service_role;
insert into public.inquiries (creator_id, name, email, message) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'Web visitor', 'v@x.example', 'Interested in a collab');
rollback;

begin;
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['creator_profile','ideas','posts','deals','revenue_entries','agent_events','inquiries'] loop
    begin
      execute format('select count(*) from public.%I', t);
      raise exception 'RLS FAILURE: anon could read %', t;
    exception when insufficient_privilege then null; end;
    begin
      execute format('delete from public.%I', t);
      raise exception 'RLS FAILURE: anon could delete from %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'PASS 6: service_role insert works; anon has no read or write on any table';
end $$;
rollback;

-- ── 7. A user with no profile sees nothing ────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2cCcCcCcCcCcCcCcCcCcCcCcCcC', true);
do $$
begin
  assert (select count(*) from public.ideas) = 0 and (select count(*) from public.creator_profile) = 0, 'stranger sees rows';
  raise notice 'PASS 7: an authenticated user without a profile sees no rows';
end $$;
rollback;

-- ── 8. Constraints and triggers ───────────────────────────────────────────
begin;
do $$
declare s timestamptz; u timestamptz; n int;
begin
  begin insert into public.ideas (creator_id, status) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'bogus'); raise exception 'accepted bad idea status';
  exception when check_violation then null; end;
  begin insert into public.deals (creator_id, stage) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'won'); raise exception 'accepted bad stage';
  exception when check_violation then null; end;
  begin insert into public.revenue_entries (creator_id, amount, status) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 1, 'late'); raise exception 'accepted bad invoice status';
  exception when check_violation then null; end;
  begin insert into public.revenue_entries (creator_id, amount, currency) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 1, 'US'); raise exception 'accepted bad currency';
  exception when check_violation then null; end;
  begin insert into public.revenue_entries (creator_id, amount) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', -5); raise exception 'accepted negative amount';
  exception when check_violation then null; end;
  begin insert into public.posts (creator_id, views) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', -1); raise exception 'accepted negative views';
  exception when check_violation then null; end;
  begin insert into public.agent_events (creator_id, type) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'oops'); raise exception 'accepted bad event type';
  exception when check_violation then null; end;
  begin insert into public.agent_events (creator_id, type, pillar) values ('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 'flag', 'Vibes'); raise exception 'accepted bad pillar';
  exception when check_violation then null; end;
  begin insert into public.creator_profile (user_id) values ('user_2aAaAaAaAaAaAaAaAaAaAaAaAaA'); raise exception 'second profile for one user';
  exception when unique_violation then null; end;
  begin update public.creator_profile set goals = '[]' where id = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1'; raise exception 'accepted non-object goals';
  exception when check_violation then null; end;

  -- defaults
  insert into public.ideas (id, creator_id) values ('a0000000-0000-4000-8000-0000000000aa', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');
  assert (select status from public.ideas where id = 'a0000000-0000-4000-8000-0000000000aa') = 'idea', 'idea default status';
  insert into public.deals (id, creator_id) values ('a0000000-0000-4000-8000-0000000000bb', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');
  assert (select stage from public.deals where id = 'a0000000-0000-4000-8000-0000000000bb') = 'prospecting', 'deal default stage';
  insert into public.revenue_entries (id, creator_id, amount) values ('a0000000-0000-4000-8000-0000000000cc', 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', 1);
  assert (select status || currency from public.revenue_entries where id = 'a0000000-0000-4000-8000-0000000000cc') = 'invoicedUSD', 'invoice defaults';

  -- stage_updated_at moves only when the stage changes
  update public.deals set stage_updated_at = now() - interval '10 days' where id = 'a0000000-0000-4000-8000-0000000000bb';
  update public.deals set brand = 'renamed' where id = 'a0000000-0000-4000-8000-0000000000bb';
  select stage_updated_at into s from public.deals where id = 'a0000000-0000-4000-8000-0000000000bb';
  assert s < now() - interval '9 days', 'stage clock must not reset on unrelated edits';
  update public.deals set stage = 'negotiating' where id = 'a0000000-0000-4000-8000-0000000000bb';
  select stage_updated_at into s from public.deals where id = 'a0000000-0000-4000-8000-0000000000bb';
  assert s > now() - interval '1 minute', 'stage clock must reset when the stage changes';

  -- updated_at advances on update
  update public.ideas set updated_at = now() - interval '1 day' where id = 'a0000000-0000-4000-8000-0000000000aa';
  update public.ideas set hook = 'edited' where id = 'a0000000-0000-4000-8000-0000000000aa';
  select updated_at into u from public.ideas where id = 'a0000000-0000-4000-8000-0000000000aa';
  assert u > now() - interval '1 minute', 'updated_at trigger';

  -- deleting a profile cascades to everything it owns
  delete from public.creator_profile where id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  select count(*) into n from public.ideas where creator_id = 'b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1';
  assert n = 0, 'cascade delete';
  raise notice 'PASS 8: check constraints, defaults, stage clock, updated_at and cascades behave';
end $$;
rollback;

-- ── 9. Storage bucket and per-user folders ────────────────────────────────
do $$
begin
  assert (select public from storage.buckets where id = 'creator-assets'), 'creator-assets bucket must be public';
  assert (select file_size_limit from storage.buckets where id = 'creator-assets') = 2097152, 'avatar size limit';
  raise notice 'PASS 9a: creator-assets bucket is public with a 2 MB limit';
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', true);
do $$
begin
  insert into storage.objects (bucket_id, name) values ('creator-assets', 'user_2aAaAaAaAaAaAaAaAaAaAaAaAaA/avatar.png');
  begin
    insert into storage.objects (bucket_id, name) values ('creator-assets', 'user_2bBbBbBbBbBbBbBbBbBbBbBbBbB/avatar.png');
    raise exception 'RLS FAILURE: A uploaded into B folder';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects (bucket_id, name) values ('creator-assets', 'avatar.png');
    raise exception 'RLS FAILURE: A uploaded to the bucket root';
  exception when insufficient_privilege then null; end;
  raise notice 'PASS 9b: users can only write inside their own storage folder';
end $$;
rollback;

-- ── 10. No session token means no access at all ───────────────────────────
begin;
set local role anon;
do $$
declare t text;
begin
  foreach t in array array['creator_profile','ideas','posts','deals','revenue_entries','agent_events','inquiries'] loop
    begin
      execute 'select count(*) from public.' || t;
      raise exception 'RLS FAILURE: anon could read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  raise notice 'PASS 10a: anon cannot read any table';
end $$;
rollback;

begin;
set local role authenticated;
-- A token-less request as `authenticated` (should not happen in practice): sub is null, so nothing matches.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '', true);
do $$
begin
  assert (select count(*) from public.creator_profile) = 0 and (select count(*) from public.deals) = 0, 'a request without a subject saw rows';
  begin
    insert into public.creator_profile (user_id, name) values ('user_2aAaAaAaAaAaAaAaAaAaAaAaAaA', 'x');
    raise exception 'RLS FAILURE: wrote a profile without a subject';
  exception when insufficient_privilege or unique_violation then null; end;
  raise notice 'PASS 10b: a request without a subject sees and writes nothing';
end $$;
rollback;

-- ── 11. The Clerk user id comes from the token's `sub` claim ──────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"user_2dDdDdDdDdDdDdDdDdDdDdDdDdD","role":"authenticated"}', true);
do $$
declare owner_id text;
begin
  insert into public.creator_profile (name) values ('Creator D') returning user_id into owner_id;
  assert owner_id = 'user_2dDdDdDdDdDdDdDdDdDdDdDdDdD', 'user_id should default to the token subject, got ' || coalesce(owner_id, 'null');
  assert (select count(*) from public.creator_profile) = 1, 'D sees only D';
  insert into public.deals (creator_id, brand)
    select id, 'D brand' from public.creator_profile;
  assert (select count(*) from public.deals) = 1, 'D can add to its own profile';
  raise notice 'PASS 11: user_id defaults to the token subject and scopes everything that follows';
end $$;
rollback;

\echo ALL RLS TESTS PASSED
