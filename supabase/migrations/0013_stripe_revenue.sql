-- 0013: connect a creator's own Stripe account to Revenue (read-only).
--
-- The creator pastes a RESTRICTED Stripe key (rk_...) that can only read charges. PBOS stores it encrypted (AES-256-GCM, same
-- key ring as the YouTube and Instagram tokens) and reads their paid charges into revenue_entries, marked source = 'stripe'.
-- Only the server (service role) reads the key or writes Stripe rows. The signed-in role can read the non-secret columns of its own
-- connection, and can never create, edit or delete a Stripe-sourced revenue row (so "from Stripe" always means from Stripe).

create table public.stripe_connections (
  creator_id      uuid primary key references public.creator_profile (id) on delete cascade,
  key_enc         text not null check (key_enc ~ '^v[0-9]+:'),
  livemode        boolean not null,
  status          text not null default 'active' check (status in ('active', 'invalid')),
  last_error      text check (char_length(last_error) <= 300),
  last_synced_at  timestamptz,
  charges_seen    integer not null default 0 check (charges_seen >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.stripe_connections enable row level security;
revoke all on public.stripe_connections from anon, authenticated;
grant select (creator_id, livemode, status, last_error, last_synced_at, charges_seen, created_at) on public.stripe_connections to authenticated;

create policy stripe_connections_select on public.stripe_connections
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));

alter table public.revenue_entries
  add column source text not null default 'manual' check (source in ('manual', 'stripe')),
  add column external_id text check (char_length(external_id) <= 100),
  add constraint revenue_entries_external_unique unique (creator_id, external_id),
  add constraint revenue_entries_stripe_has_id check (source = 'manual' or external_id is not null);

-- Signed-in users may only create and change manual rows. The server (service role) writes Stripe rows.
create or replace function public.guard_stripe_revenue() returns trigger
language plpgsql set search_path = public as $$
declare role_claim text := coalesce(((select auth.jwt()) ->> 'role'), '');
begin
  if role_claim <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source <> 'manual' or new.external_id is not null then raise exception 'stripe revenue rows are written by the server only'; end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.source <> 'manual' or new.source <> 'manual' or new.external_id is not null then raise exception 'stripe revenue rows cannot be edited'; end if;
    return new;
  else
    if old.source <> 'manual' then raise exception 'stripe revenue rows cannot be deleted by hand; disconnect Stripe to remove them'; end if;
    return old;
  end if;
end;
$$;

create trigger revenue_entries_guard_stripe
  before insert or update or delete on public.revenue_entries
  for each row execute function public.guard_stripe_revenue();
