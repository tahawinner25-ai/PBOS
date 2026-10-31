-- Tests for 0007_agent_actions.sql. Runs after 30_upserts.test.sql on the same scratch database.
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
create function tt.expect_rows(p_sql text, p_expected integer, p_label text) returns void
language plpgsql as $$
declare n integer;
begin
  execute p_sql;
  get diagnostics n = row_count;
  assert n = p_expected, format('%s: expected %s affected rows, got %s', p_label, p_expected, n);
end $$;

insert into public.creator_profile (id, user_id, name) values
  ('4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', 'user_2gGgGgGgGgGgGgGgGgGgGgGgGgG', 'Creator E'),
  ('4b4b4b4b-4b4b-444b-8b4b-4b4b4b4b4b4b', 'user_2hHhHhHhHhHhHhHhHhHhHhHhHhH', 'Creator F');

insert into public.agent_actions (id, creator_id, run_id, tool, tier, status, summary, args, result) values
  ('e0000000-0000-4000-8000-0000000000a1', '4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'create_idea', 'create', 'done', 'E idea', '{}', '{"kind":"idea"}'),
  ('e0000000-0000-4000-8000-0000000000a2', '4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'move_deal', 'change', 'pending', 'E move deal', '{"stage":"negotiating"}', '{}'),
  ('f0000000-0000-4000-8000-0000000000a1', '4b4b4b4b-4b4b-444b-8b4b-4b4b4b4b4b4b', gen_random_uuid(), 'create_idea', 'create', 'done', 'F idea', '{}', '{}');

-- ── 40. RLS on, no anon access ────────────────────────────────────────────
do $$
begin
  assert (select relrowsecurity from pg_class where oid = 'public.agent_actions'::regclass), 'RLS not enabled on agent_actions';
  assert not has_table_privilege('anon', 'public.agent_actions', 'select'), 'anon can select agent_actions';
  assert not has_table_privilege('anon', 'public.agent_actions', 'insert'), 'anon can insert agent_actions';
  assert not has_table_privilege('authenticated', 'public.agent_actions', 'delete'), 'signed-in role can delete agent_actions';
  raise notice 'PASS 40: RLS on, anon has nothing, nobody can delete';
end $$;

-- ── 41. Isolation: E sees only E's rows ───────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2gGgGgGgGgGgGgGgGgGgGgGgGgG', true);
do $$
begin
  assert (select count(*) from public.agent_actions) = 2, 'E should see its 2 actions';
  assert (select count(*) from public.agent_actions where creator_id = '4b4b4b4b-4b4b-444b-8b4b-4b4b4b4b4b4b') = 0, 'E can read F actions';
  raise notice 'PASS 41: creator E sees only its own actions';
end $$;
rollback;

-- ── 42. Another creator cannot add, settle or reach E's rows ──────────────
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2hHhHhHhHhHhHhHhHhHhHhHhHhH', true);
do $$
begin
  perform tt.expect_error($q$insert into public.agent_actions (creator_id, run_id, tool, tier, status, summary) values ('4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'create_idea', 'create', 'done', 'forged for E')$q$, '42501', 'insert for another creator');
  perform tt.expect_rows($q$update public.agent_actions set status = 'approved' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, 0, 'settle another creator action');
  perform tt.expect_rows($q$update public.agent_actions set status = 'undone' where id = 'e0000000-0000-4000-8000-0000000000a1'$q$, 0, 'undo another creator action');
  raise notice 'PASS 42: F cannot forge, approve or undo E actions';
end $$;
rollback;

-- ── 43. The creator can settle but not rewrite what was asked, and a decision is final ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2gGgGgGgGgGgGgGgGgGgGgGgGgG', true);
do $$
begin
  perform tt.expect_error($q$update public.agent_actions set args = '{"stage":"paid"}' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '42501', 'rewrite args');
  perform tt.expect_error($q$update public.agent_actions set summary = 'something else' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '42501', 'rewrite summary');
  perform tt.expect_error($q$update public.agent_actions set tool = 'delete_everything' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '42501', 'rewrite tool');
  perform tt.expect_error($q$update public.agent_actions set status = 'done' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'a change action cannot be done');
  perform tt.expect_rows($q$update public.agent_actions set status = 'approved' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, 1, 'approve own pending action');
  assert (select decided_at from public.agent_actions where id = 'e0000000-0000-4000-8000-0000000000a2') is not null, 'decided_at set';
  perform tt.expect_error($q$update public.agent_actions set status = 'dismissed' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'change a decision');
  perform tt.expect_error($q$update public.agent_actions set status = 'pending' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'revive a decision');
  perform tt.expect_rows($q$update public.agent_actions set status = 'undone' where id = 'e0000000-0000-4000-8000-0000000000a1'$q$, 1, 'undo own create action');
  perform tt.expect_error($q$delete from public.agent_actions$q$, '42501', 'delete');
  raise notice 'PASS 43: settling works, rewriting and reviving are refused';
end $$;
rollback;

-- ── 44. Impossible tier/status pairs and oversized payloads are refused ───
do $$
begin
  perform tt.expect_error($q$insert into public.agent_actions (creator_id, run_id, tool, tier, status, summary) values ('4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'create_idea', 'create', 'pending', 'x')$q$, '23514', 'pending create');
  perform tt.expect_error($q$insert into public.agent_actions (creator_id, run_id, tool, tier, status, summary) values ('4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'move_deal', 'change', 'done', 'x')$q$, '23514', 'done change');
  perform tt.expect_error(format($q$insert into public.agent_actions (creator_id, run_id, tool, tier, status, summary, args) values ('4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a', gen_random_uuid(), 'move_deal', 'change', 'pending', 'x', %L)$q$, jsonb_build_object('a', repeat('x', 9000))), '23514', 'oversized args');
  raise notice 'PASS 44: tier/status pairs and payload size enforced';
end $$;


-- ── 44b. An approved action may be marked failed, and nothing else may leave a decided state ─
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'user_2gGgGgGgGgGgGgGgGgGgGgGgGgG', true);
do $$
begin
  perform tt.expect_rows($q$update public.agent_actions set status = 'approved' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, 1, 'approve');
  perform tt.expect_rows($q$update public.agent_actions set status = 'failed', result = '{"error":"deal not found"}' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, 1, 'approved -> failed');
  perform tt.expect_error($q$update public.agent_actions set status = 'approved' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'failed -> approved');
  perform tt.expect_error($q$update public.agent_actions set status = 'pending' where id = 'e0000000-0000-4000-8000-0000000000a2'$q$, '23514', 'failed -> pending');
  raise notice 'PASS 44b: approved may become failed; decisions are otherwise final';
end $$;
rollback;

-- ── 45. Deleting the creator removes the log ──────────────────────────────
delete from public.creator_profile where id = '4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a';
do $$
begin
  assert (select count(*) from public.agent_actions where creator_id = '4a4a4a4a-4a4a-444a-8a4a-4a4a4a4a4a4a') = 0, 'actions survived creator deletion';
  raise notice 'PASS 45: deleting a creator deletes its agent actions';
end $$;

drop schema tt cascade;
