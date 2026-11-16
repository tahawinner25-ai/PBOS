-- 0016: invoices the agent issues through the creator's own Stripe, and the webhook that keeps them up to date.
--
-- The creator's restricted key may now also have write access to Customers, Invoices, Invoice items and Webhook endpoints.
-- PBOS only ever creates, finalizes and sends an invoice (collection_method send_invoice: the customer pays, PBOS never charges
-- anyone), and only after the creator presses Approve on a card that shows the recipient, amount and due date.

alter table public.stripe_connections
  add column if not exists webhook_id text check (webhook_id is null or webhook_id ~ '^we_[A-Za-z0-9]+$'),
  add column if not exists webhook_secret_enc text check (webhook_secret_enc is null or webhook_secret_enc ~ '^v[0-9]+:'),
  add column if not exists webhook_last_event_at timestamptz;

-- The signing secret is never readable by the signed-in role; only whether a webhook exists and when it last fired.
grant select (webhook_id, webhook_last_event_at) on public.stripe_connections to authenticated;

alter table public.revenue_entries
  add column if not exists stripe_invoice_id text check (stripe_invoice_id is null or stripe_invoice_id ~ '^in_[A-Za-z0-9]+$'),
  add column if not exists stripe_invoice_url text check (stripe_invoice_url is null or (stripe_invoice_url ~ '^https://' and char_length(stripe_invoice_url) <= 500));

create unique index if not exists revenue_entries_stripe_invoice_unique on public.revenue_entries (creator_id, stripe_invoice_id) where stripe_invoice_id is not null;

-- Signed-in users cannot set or change the Stripe invoice link, so "issued through Stripe" always means the server did it.
create or replace function public.guard_stripe_revenue() returns trigger
language plpgsql set search_path = public as $$
declare role_claim text := coalesce(((select auth.jwt()) ->> 'role'), '');
begin
  if role_claim <> 'authenticated' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source <> 'manual' or new.external_id is not null or new.stripe_invoice_id is not null or new.stripe_invoice_url is not null then raise exception 'stripe revenue rows are written by the server only'; end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.source <> 'manual' or new.source <> 'manual' or new.external_id is not null then raise exception 'stripe revenue rows cannot be edited'; end if;
    if new.stripe_invoice_id is distinct from old.stripe_invoice_id or new.stripe_invoice_url is distinct from old.stripe_invoice_url then raise exception 'the Stripe invoice link is set by the server only'; end if;
    return new;
  else
    if old.source <> 'manual' then raise exception 'stripe revenue rows cannot be deleted by hand; disconnect Stripe to remove them'; end if;
    return old;
  end if;
end;
$$;
