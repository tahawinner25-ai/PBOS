-- 0007: the agent's action log.
--
-- Every thing the in-app agent does is recorded here, in one of two shapes:
--   * tier 'create'  : it made a new record (an idea, a draft, an image). status 'done', with a pointer to the
--                      record in `result` so the creator can undo it.
--   * tier 'change'  : it wants to alter something that already exists. status 'pending' until the creator
--                      approves or dismisses it; nothing is executed before that.
-- The agent has no tool that publishes, emails, pays or deletes, so this log is also the audit trail for
-- "what did the agent do for me".
--
-- Rows are the creator's own. The signed-in role can read them, add them and settle them (status, decision
-- time, result), but cannot rewrite what was asked for (tool, summary, args) and cannot delete rows.

create table public.agent_actions (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profile (id) on delete cascade,
  run_id     uuid not null,
  tool       text not null check (char_length(tool) between 1 and 60),
  tier       text not null check (tier in ('create', 'change')),
  status     text not null check (status in ('done', 'pending', 'approved', 'dismissed', 'failed', 'undone')),
  summary    text not null check (char_length(summary) between 1 and 400),
  -- The validated arguments. Never a credential: tools take ids, text and dates only.
  args       jsonb not null default '{}'::jsonb,
  -- Pointer to what was made or changed, for example {"kind":"idea","id":"…","href":"/ideas"}.
  result     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint agent_actions_args_is_object check (jsonb_typeof(args) = 'object'),
  constraint agent_actions_result_is_object check (jsonb_typeof(result) = 'object'),
  constraint agent_actions_args_size check (octet_length(args::text) <= 8000),
  constraint agent_actions_result_size check (octet_length(result::text) <= 2000),
  -- A 'create' action is never pending, and a 'change' action is never 'done' without having been approved.
  constraint agent_actions_tier_status check (
    (tier = 'create' and status in ('done', 'failed', 'undone'))
    or (tier = 'change' and status in ('pending', 'approved', 'dismissed', 'failed'))
  )
);
create index agent_actions_creator_created_idx on public.agent_actions (creator_id, created_at desc);
create index agent_actions_creator_run_idx on public.agent_actions (creator_id, run_id);
create index agent_actions_pending_idx on public.agent_actions (creator_id) where status = 'pending';

alter table public.agent_actions enable row level security;

revoke all on public.agent_actions from anon;
revoke all on public.agent_actions from authenticated;
grant select on public.agent_actions to authenticated;
grant insert (creator_id, run_id, tool, tier, status, summary, args, result) on public.agent_actions to authenticated;
grant update (status, decided_at, result) on public.agent_actions to authenticated;

create policy agent_actions_select on public.agent_actions
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

create policy agent_actions_insert on public.agent_actions
  for insert to authenticated
  with check (
    creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub'))
    and status in ('done', 'pending')
  );

create policy agent_actions_update on public.agent_actions
  for update to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')))
  with check (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

-- Settling an action is one-way: once decided it cannot go back to pending, and a 'create' action can only
-- move to 'undone' or 'failed'. (The tier/status check above already prevents impossible pairs; this trigger
-- prevents reviving a decided row.)
create function public.agent_actions_settle_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' and old.status <> 'done' and new.status is distinct from old.status then
    raise exception 'agent action % is already %', old.id, old.status using errcode = '23514';
  end if;
  if new.status = 'pending' and old.status <> 'pending' then
    raise exception 'an agent action cannot return to pending' using errcode = '23514';
  end if;
  if new.status in ('approved', 'dismissed', 'undone', 'failed') and new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end $$;
create trigger agent_actions_settle before update on public.agent_actions
  for each row execute function public.agent_actions_settle_guard();
