# Go live checklist (what only the owner can do)

Everything below needs an account or secret that belongs to you. Put secrets in Vercel -> Project `pbos-app` -> Settings ->
Environment Variables (Production and Preview, mark them Sensitive). Never paste them in chat or commit them.

## 1. Sign in (Clerk)
1. Clerk dashboard -> your app -> API Keys: copy the publishable and secret keys.
2. Vercel variables: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`.
3. Clerk dashboard -> Integrations -> Supabase (third-party auth), activate it, then in Supabase -> Authentication ->
   Sign In / Providers -> Third-party -> add Clerk with your Clerk domain. Row-level security reads `auth.jwt()->>'sub'`.
4. Supabase -> Project Settings -> API: copy the service role key into `SUPABASE_SERVICE_ROLE_KEY` (server only).
5. Redeploy. `/login` and `/signup` then show Clerk. Clerk development keys work on `*.vercel.app`; production keys need a domain you own.

## 2. YouTube and Gmail (Google Cloud)
Variables: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Enable YouTube Data API v3 and Gmail API. Redirect URIs:
- `https://pbos-app-green.vercel.app/api/connect/youtube/callback`
- `https://pbos-app-green.vercel.app/api/connect/gmail/callback`
Add yourself as a Test user while the consent screen is in Testing. Details: `docs/INTEGRATIONS.md`.

## 3. Instagram (Meta)
Variables: `META_APP_ID`, `META_APP_SECRET`. Redirect URI `https://pbos-app-green.vercel.app/api/connect/instagram/callback`;
the deauthorize and data-deletion URLs are listed in `docs/INTEGRATIONS.md`. Publishing needs a Business or Creator account.

## 4. The agent
`ANTHROPIC_API_KEY` (agent and web search). `OPENAI_API_KEY` only for image generation.
Optional: `EMAIL_DAILY_LIMIT`, `AGENT_SEARCH_DAILY_LIMIT`, `ANTHROPIC_WEB_SEARCH_TOOL`.

## 5. Scheduled jobs and CI
GitHub -> Settings -> Secrets and variables -> Actions: add `PBOS_URL` (the production URL) and `CRON_SECRET` (the same value as the Vercel variable).
Run the "Lockfile" workflow once, then CI can switch to `npm ci`.

## 6. Check it
Sign up, connect each account on **Connections**, then ask the agent: "email <a deal contact> about the contract". It
queues an email card; nothing leaves until you click Approve.
