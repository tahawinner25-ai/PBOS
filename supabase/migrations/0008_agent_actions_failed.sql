-- 0008: an approved agent action that then fails to run may be marked 'failed'.
--
-- 0007 made every decision final. But approval is claimed first (pending -> approved) so that a double click
-- cannot run the change twice, and only then is the change executed; if that execution fails, the row must be
-- able to say so. This is the only transition out of a decided state that is allowed.

create or replace function public.agent_actions_settle_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'approved' and new.status = 'failed' then
    null; -- allowed: the approved change could not be applied
  elsif old.status <> 'pending' and old.status <> 'done' and new.status is distinct from old.status then
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
