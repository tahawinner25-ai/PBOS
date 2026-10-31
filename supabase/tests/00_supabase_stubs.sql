-- Minimal stand-ins for the parts of Supabase the migrations depend on, so the
-- schema and RLS policies can be tested on a plain PostgreSQL instance.
-- NEVER run this against a real Supabase project.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

-- Same behaviour as Supabase: the verified session token is exposed through a request setting,
-- and auth.jwt() returns its claims. PBOS identifies the creator by the Clerk user id in `sub`.
create function auth.jwt() returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_strip_nulls(jsonb_build_object('sub', nullif(current_setting('request.jwt.claim.sub', true), '')))
  )
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants table privileges to these roles by default; mimic that so RLS and
-- the explicit revokes in 0002_rls.sql are what actually decide access.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- Real implementation returns the folder segments of an object path (without the file name).
create function storage.foldername(name text) returns text[]
language sql immutable
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;
grant all on storage.objects, storage.buckets to service_role;
