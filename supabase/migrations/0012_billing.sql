-- 0012: PBOS Pro subscription state (Stripe).
--
-- One row per creator who has started a subscription. Stripe is the source of truth for money; this table is a
-- mirror kept up to date by the signed webhook, so the app can show the plan without calling Stripe on every page.
-- Only the server (service role) writes. The signed-in role can read its own row, and only the non-identifying columns.
--
-- price_step: 0 is $10.00, 1 is $9.75 ... 20 is $5.00. It moves up by one after every 3 paid months, until 20.
-- periods_paid is the number of paid invoices Stripe reports for the subscription, so the step comes from facts, not the calendar,
-- and replaying a webhook can never count a month twice.

create table public.subscriptions (
  creator_id             uuid primary key references public.creator_profile (id) on delete cascade,
  stripe_customer_id     text not null,
  stripe_subscription_id text not null unique,
  status                 text not null check (status in ('incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused')),
  price_step             integer not null default 0 check (price_step between 0 and 20),
  periods_paid           integer not null default 0 check (periods_paid >= 0),
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

revoke all on public.subscriptions from anon, authenticated;
grant select (creator_id, status, price_step, periods_paid, current_period_end, cancel_at_period_end) on public.subscriptions to authenticated;

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (creator_id in (select id from public.creator_profile where user_id = ((select auth.jwt()) ->> 'sub')));
