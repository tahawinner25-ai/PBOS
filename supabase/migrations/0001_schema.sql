-- PBOS schema. Single-creator MVP: one creator_profile per signed-in user.
--
-- Identity comes from Clerk, verified by Supabase through Third-Party Auth. The Clerk user id
-- (a string like user_2abc...) is read from the session token's `sub` claim: auth.jwt() ->> 'sub'.
-- There is no auth.users foreign key because Clerk users do not live in Supabase Auth.
--
-- Columns beyond the product spec (all additive, all documented in README):
--   creator_profile.media_kit_published  keeps /work-with-me private until the creator publishes it
--   creator_profile.avatar_path          path of the avatar in the creator-assets storage bucket
--   ideas.adapted_from                   links a platform-specific adaptation to its source idea
--   ideas/posts/deals/revenue_entries.is_demo  marks seeded demo rows so they can be shown and removed
--   inquiries (new table)                stores contact-form submissions from /work-with-me

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── creator_profile ───────────────────────────────────────────────────────
create table public.creator_profile (
  id                  uuid primary key default gen_random_uuid(),
  user_id             text not null unique default (auth.jwt() ->> 'sub'),
  name                text,
  niche               text,
  positioning         text,
  voice               text,
  goals               jsonb not null default '{}'::jsonb,
  audience_notes      text,
  services            jsonb not null default '[]'::jsonb,
  rate_card           jsonb not null default '[]'::jsonb,
  faq                 jsonb not null default '[]'::jsonb,
  ai_persona          jsonb,
  media_kit_published boolean not null default false,
  avatar_path         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint creator_profile_goals_is_object check (jsonb_typeof(goals) = 'object'),
  constraint creator_profile_services_is_array check (jsonb_typeof(services) = 'array'),
  constraint creator_profile_rate_card_is_array check (jsonb_typeof(rate_card) = 'array'),
  constraint creator_profile_faq_is_array check (jsonb_typeof(faq) = 'array')
);

-- ── ideas ─────────────────────────────────────────────────────────────────
create table public.ideas (
  id            uuid primary key default gen_random_uuid(),
  creator_id    uuid not null references public.creator_profile (id) on delete cascade,
  platform      text,
  format        text,
  hook          text,
  hook_variants jsonb not null default '[]'::jsonb,
  script        text,
  status        text not null default 'idea'
                  check (status in ('idea', 'scripted', 'scheduled', 'posted', 'measured')),
  content_mix   text,
  scheduled_for date,
  adapted_from  uuid references public.ideas (id) on delete set null,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint ideas_hook_variants_is_array check (jsonb_typeof(hook_variants) = 'array')
);
create index ideas_creator_status_idx on public.ideas (creator_id, status);
create index ideas_creator_scheduled_idx on public.ideas (creator_id, scheduled_for);
create index ideas_adapted_from_idx on public.ideas (adapted_from);

-- ── posts ─────────────────────────────────────────────────────────────────
create table public.posts (
  id           uuid primary key default gen_random_uuid(),
  creator_id   uuid not null references public.creator_profile (id) on delete cascade,
  idea_id      uuid references public.ideas (id) on delete set null,
  platform     text,
  format       text,
  published_at timestamptz,
  views        integer check (views >= 0),
  likes        integer check (likes >= 0),
  comments     integer check (comments >= 0),
  shares       integer check (shares >= 0),
  saves        integer check (saves >= 0),
  clicks       integer check (clicks >= 0),
  notes        text,
  is_demo      boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index posts_creator_published_idx on public.posts (creator_id, published_at desc);
create index posts_idea_idx on public.posts (idea_id);

-- ── deals ─────────────────────────────────────────────────────────────────
create table public.deals (
  id                  uuid primary key default gen_random_uuid(),
  creator_id          uuid not null references public.creator_profile (id) on delete cascade,
  brand               text,
  contact_name        text,
  contact_email       text,
  stage               text not null default 'prospecting'
                        check (stage in ('prospecting', 'negotiating', 'contracted', 'delivery', 'paid')),
  value               numeric check (value >= 0),
  expected_close_date date,
  deliverables        jsonb not null default '[]'::jsonb,
  notes               text,
  stage_updated_at    timestamptz not null default now(),
  is_demo             boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint deals_deliverables_is_array check (jsonb_typeof(deliverables) = 'array')
);
create index deals_creator_stage_idx on public.deals (creator_id, stage);

-- Reset the "days in current stage" clock whenever the stage changes.
create or replace function public.deals_touch_stage()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_updated_at = now();
  end if;
  return new;
end;
$$;

-- ── revenue_entries ───────────────────────────────────────────────────────
create table public.revenue_entries (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profile (id) on delete cascade,
  deal_id    uuid references public.deals (id) on delete set null,
  amount     numeric not null check (amount >= 0),
  currency   text not null default 'USD' check (char_length(currency) = 3),
  status     text not null default 'invoiced' check (status in ('invoiced', 'paid', 'overdue')),
  due_date   date,
  paid_at    date,
  notes      text,
  is_demo    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index revenue_creator_status_idx on public.revenue_entries (creator_id, status);
create index revenue_deal_idx on public.revenue_entries (deal_id);

-- ── agent_events (append-only log) ────────────────────────────────────────
create table public.agent_events (
  id                uuid primary key default gen_random_uuid(),
  creator_id        uuid not null references public.creator_profile (id) on delete cascade,
  type              text not null check (type in ('flag', 'suggestion', 'draft', 'accepted', 'ignored')),
  pillar            text check (pillar in ('Ideation', 'Posting', 'Analytics', 'Deals', 'Revenue')),
  payload           jsonb not null default '{}'::jsonb,
  source_record_ids jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  constraint agent_events_source_ids_is_array check (jsonb_typeof(source_record_ids) = 'array')
);
create index agent_events_creator_created_idx on public.agent_events (creator_id, created_at desc);
create index agent_events_run_idx on public.agent_events (creator_id, (payload ->> 'run_id'));

-- ── inquiries (contact form on /work-with-me) ─────────────────────────────
create table public.inquiries (
  id         uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.creator_profile (id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 120),
  email      text not null check (char_length(email) between 3 and 254),
  company    text check (char_length(company) <= 160),
  message    text not null check (char_length(message) between 1 and 4000),
  status     text not null default 'new' check (status in ('new', 'read', 'converted', 'archived')),
  created_at timestamptz not null default now()
);
create index inquiries_creator_created_idx on public.inquiries (creator_id, created_at desc);

-- ── triggers ──────────────────────────────────────────────────────────────
create trigger creator_profile_set_updated_at before update on public.creator_profile
  for each row execute function public.set_updated_at();
create trigger ideas_set_updated_at before update on public.ideas
  for each row execute function public.set_updated_at();
create trigger posts_set_updated_at before update on public.posts
  for each row execute function public.set_updated_at();
create trigger deals_set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();
create trigger deals_touch_stage before update on public.deals
  for each row execute function public.deals_touch_stage();
create trigger revenue_entries_set_updated_at before update on public.revenue_entries
  for each row execute function public.set_updated_at();
