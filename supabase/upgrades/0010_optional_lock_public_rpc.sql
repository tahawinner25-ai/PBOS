-- OPTIONAL hardening for a database that already ran the migration named "pbos_0009_mvp_operator".
--
-- That migration is NOT part of this repository. It was applied to the Supabase project on 2026-10-28 by something else
-- (another build of PBOS, or a tool session). It adds two SECURITY DEFINER functions and grants them to the `anon` role,
-- which means anyone holding the public anon key can call them over /rest/v1/rpc/...:
--
--   public.submit_inquiry(...)       inserts a contact-form message. It validates input and throttles (3 per email per
--                                     hour, 100 per day), but it skips the Cloudflare Turnstile check and the per-IP
--                                     rate limit that this app's /api/contact route applies.
--   public.get_public_media_kit()    returns the published creator's public profile fields and featured posts.
--                                     This app reads the media kit on the server instead (src/lib/server/public.ts).
--
-- This app does not call either function. If NOTHING ELSE you run (for example a different front end on the same
-- project) calls them, run this file. If something does, leave it alone and keep the Turnstile gap in mind.
--
-- It is safe to run more than once. It changes grants only; it drops nothing and touches no data.

do $$
begin
  if to_regprocedure('public.submit_inquiry(text, text, text, text)') is not null then
    revoke execute on function public.submit_inquiry(text, text, text, text) from public, anon, authenticated;
  end if;
  if to_regprocedure('public.get_public_media_kit()') is not null then
    revoke execute on function public.get_public_media_kit() from public, anon, authenticated;
  end if;
end $$;

-- The service role (used by this app's server code) keeps its access: Supabase grants it separately.
-- After running, the Supabase security advisor should no longer list these two functions.
-- The third advisor finding, public.idea_owned_by, is fixed by supabase/upgrades/0004_existing_database.sql, which moves it
-- into the private schema.
