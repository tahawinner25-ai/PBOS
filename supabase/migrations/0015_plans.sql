-- 0015: which paid plan a subscription is. 'pro' is the stepped $10 -> $5 plan, 'max' is the fixed $50 plan.
alter table public.subscriptions add column if not exists plan text not null default 'pro' check (plan in ('pro', 'max'));
grant select (plan) on public.subscriptions to authenticated;
