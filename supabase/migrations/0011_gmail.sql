-- 0011: Gmail as a third connection, and a daily counter for emails the agent sends after the creator approves them.
--
-- This only WIDENS three check constraints; every existing row stays valid, so it is safe to run on a live database
-- and safe to run before the code that uses it is deployed.
--   * social_connections.platform   may now be 'gmail' (send-only Google grant; tokens are encrypted like the others)
--   * integration_events.platform   may now be 'gmail' (the audit trail records the Gmail message id, never the text)
--   * api_usage.provider            may now be 'gmail' (bump_api_usage counts sends per creator per day)
--
-- Gmail rows never reach the YouTube or Instagram sync and refresh jobs: those select platform in ('youtube','instagram').

alter table public.social_connections drop constraint if exists social_connections_platform_check;
alter table public.social_connections add constraint social_connections_platform_check check (platform in ('youtube', 'instagram', 'gmail'));

alter table public.integration_events drop constraint if exists integration_events_platform_check;
alter table public.integration_events add constraint integration_events_platform_check check (platform in ('youtube', 'instagram', 'gmail', 'image'));

alter table public.api_usage drop constraint if exists api_usage_provider_check;
alter table public.api_usage add constraint api_usage_provider_check check (provider in ('youtube', 'instagram', 'image', 'agent', 'gmail'));
