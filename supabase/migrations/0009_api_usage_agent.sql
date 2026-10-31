-- 0009: let the daily usage counter also count the in-app agent's runs.
--
-- api_usage already holds per-creator, per-day counters for YouTube/Instagram quota and image generation.
-- The agent's runs are the most expensive thing a creator can trigger (each one calls the AI several times), so
-- they get a daily cap enforced by the same atomic counter (bump_api_usage, service role only).

alter table public.api_usage drop constraint api_usage_provider_check;
alter table public.api_usage add constraint api_usage_provider_check check (provider in ('youtube', 'instagram', 'image', 'agent'));
