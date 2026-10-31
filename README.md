# PBOS: Personal Brand Operating System

PBOS is a workspace for one creator. Each day it **scans** your own ideas, posts, deals and invoices, **flags** what
needs attention, **suggests** up to three next actions with the reason and the record behind each, **drafts** the
highest-value asset, and **learns** from what you accept or ignore. An in-app **agent** can do the preparation work for
you; you approve anything that changes an existing record, and nothing is ever published, sent or paid without you.

Areas: Ideation · Posting (YouTube and Instagram) · Analytics · Deals · Revenue · Create (images and ad drafts) · Studio
(video editing) · Agent.

**Rules the product follows**

- The AI recommends and drafts. You approve everything that leaves PBOS.
- It never invents metrics, audience size or revenue. Empty states show nothing, not fake numbers.
- Every recommendation cites a profile field, a database record or a goal you stated.
- If something critical is missing, it asks one targeted question.
- Revenue forecasts are always labelled "Estimate, not guaranteed income."
- No outcome promises, no binding legal language, and AI personas and AI images are labelled as AI.

## Where this stands

Built and unit-tested in a sandbox with no access to the package registry, so **`npm install` and `next build` have never
run on this code**. The first real build happens on your machine or on Vercel; expect to fix small things the stubs could
not catch. `docs/PRELAUNCH.md` lists every check that passed, every one that was not run, and what is still yours to do.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind CSS · shadcn-style UI · **Clerk** (sign-in, including Google) ·
**Supabase** (Postgres with row-level security, private storage) · **Cloudflare Turnstile** · Vercel · Anthropic API for
the agent and drafting · optional OpenAI for images.

Clerk Core 2 (`@clerk/nextjs` 6.x) is used because Clerk's newer major version needs Next.js 15.2.8 or later; this project
is on Next 14.

## Run it locally

```bash
npm install
cp .env.example .env.local     # fill it in (see "Configuration")
npm run dev                    # http://localhost:3000
```

Without Clerk or Supabase keys the public pages still work. In development the private pages show a checklist of the
missing variable **names**; in production a visitor sees only a plain "sign-in isn't open yet" message, and the missing
names go to the server log.

## Configuration

`.env.example` documents every variable with its source. Set them in `.env.local` (development) or in Vercel → Project →
Settings → Environment Variables (production). Only `NEXT_PUBLIC_*` values reach the browser. **Never commit real values.**
`npm run gen-keys` prints fresh random values for every secret you must generate; it writes nothing.

| Group | Variables | Needed for |
| --- | --- | --- |
| Sign-in | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | everything private |
| Database | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only) | records; the service key also enables uploads, the public media kit, the contact form and cron |
| AI | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `AGENT_DAILY_LIMIT` | agent and drafting; without a key the daily review falls back to rules |
| Images | `OPENAI_API_KEY`, `OPENAI_IMAGE_MODEL`, `IMAGE_DAILY_LIMIT` | image generation; without a key the button says so |
| Site | `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_COMPANY_*`, `NEXT_PUBLIC_GOVERNING_LAW` | canonical URLs, OAuth redirects, legal pages (empty values show as `[bracketed]` placeholders) |
| Sign-up | `SINGLE_CREATOR_MODE` | sign-up is **open by default**; `true` makes a private instance |
| Cloudflare | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TRUST_CLOUDFLARE` | contact form and demo bot check |
| Demo | `DEMO_SESSION_SECRET` | the 10-minute locked demo at `/demo` |
| Connections | `TOKEN_ENCRYPTION_KEYS`, `OAUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, `META_WEBHOOK_VERIFY_TOKEN` | YouTube and Instagram (`docs/INTEGRATIONS.md`) |
| Cron | `CRON_SECRET` | scheduled jobs |

## Setup, in order

### 1. Supabase

Create a project, then run the SQL files in `supabase/migrations/` **in this order** (SQL editor, or `supabase db push`):

| File | Adds |
| --- | --- |
| `0001_schema.sql` | tables, constraints, triggers |
| `0002_rls.sql` | row-level security, grants, helper function |
| `0003_storage.sql` | `creator-assets` bucket (public profile photos, 2 MB) |
| `0005_integrations.sql` | connections, publish jobs, media, analytics, ads, `creator-media` bucket (private, 50 MB) |
| `0006_upserts.sql` | idempotent sync and posting functions (service role only) |
| `0007_agent_actions.sql` | the agent's pending and settled actions |
| `0008_agent_actions_failed.sql` | `failed` state for approved actions |
| `0009_api_usage_agent.sql` | per-day usage counters for the agent |

`0004` is not in that list on purpose: `supabase/upgrades/0004_existing_database.sql` is for a database that already ran
the **first version** of 0001 to 0003. A fresh install skips it.

The service-role key bypasses row-level security. It is read only on the server. `npm run check:secrets` fails if it
appears in client code.

### 2. Clerk

1. Copy the **publishable** and **secret** keys into the variables above.
2. **Connect Clerk to Supabase** (both sides are required). Clerk Dashboard → *Integrations* → *Supabase* → activate and
   copy the Clerk domain. Supabase Dashboard → *Authentication* → *Third-Party Auth* → add **Clerk** with that domain.
3. **Google sign-in:** switch on *Continue with Google* in Clerk → *User & Authentication* → *Social connections*.
   `docs/AUTH-GOOGLE.md` has the steps, including using your own Google credentials for production.
4. Pages: `/login`, `/signup`, then `/onboarding`, where the creator profile is created.

How identity reaches the database: each request sends the creator's Clerk session token to Supabase, and row-level
security reads the Clerk user id from the token's `sub` claim. A request with no token runs as `anon`, which has no
table privileges.

### 3. Who can sign up

Sign-up is open: every creator's rows are isolated by row-level security. For a private instance (just you), set
`SINGLE_CREATOR_MODE=true` **and** set Clerk → *Restrictions* → sign-up mode to **Restricted**, then create your own account.

### 4. YouTube and Instagram, scheduled jobs

Follow `docs/INTEGRATIONS.md`. Instagram scheduled posts go out only if something calls `/api/cron/publish` every few
minutes; `.github/workflows/cron.yml` does that once you add the `PBOS_URL` and `CRON_SECRET` repository secrets.

### 5. Cloudflare

Turnstile protects the contact form and the demo start. Proxying the site through Cloudflare is optional. See
`docs/CLOUDFLARE.md`. Only you can switch these on in the dashboard.

### 6. Deploy

1. Create an empty GitHub repository, then `git init && git add -A && git commit -m "PBOS" && git push`.
2. Import it in Vercel (framework: Next.js). Add the environment variables **before** the first production deploy.
3. Open `/login`, sign in, finish onboarding, and check the browser console on `/login`, `/signup` and `/work-with-me` for
   Content-Security-Policy errors.
4. Work through `docs/PRELAUNCH.md`, then the attack runbook in `docs/SECURITY.md`.

## The agent

The agent lives at `/agent` and reads your workspace with plain tools (ideas, posts, deals, revenue, connections). It has
three tiers, enforced in code (`src/lib/agent/runner.ts`), not by asking the model nicely:

| Tier | Examples | What happens |
| --- | --- | --- |
| Read | list ideas, read a deal | runs immediately |
| Create | new idea, script, hook variants, publish *draft*, image, ad draft, log a post | runs, then PBOS re-reads the record to **verify** it was saved, shows "Checked: …", and offers **Undo** |
| Change | edit an existing record | never runs in the loop; waits as a pending action until you click **Approve** |

There is no tool that publishes, approves, sends, pays, submits ads or deletes (a test enforces this). Each run is capped
(steps, tool calls, images, time), per-creator daily limits are stored in the database, and the reply is checked against
your data: an invented figure is replaced with a plain account of what was actually done.

## Studio (video editing)

`/studio` cuts, joins, trims, captions and re-shapes short videos in the browser (Reels, Shorts, feed). Your footage stays
on your device while you edit. Limits to know: export is **real time** (a 60-second video takes about 60 seconds),
**MP4 (H.264)** is produced only by browsers that can record it (otherwise WebM, which Instagram will not take), library
files are up to 50 MB and local files up to 300 MB, and the exported file is not stored between visits unless you choose
"Save to my library".

## Checks

```bash
npm run typecheck       # TypeScript
npm run lint            # next lint
npm test                # unit tests: rules, validation, agent, publishing engine, security helpers, studio, accessibility
npm run test:rls        # applies the SQL to a throwaway PostgreSQL and tests row-level security (needs PostgreSQL binaries)
npm run check:secrets   # no secrets in the tree, no real .env files, client code reads only NEXT_PUBLIC_ variables
npm run check:links     # every internal link and redirect points at a real route
npm run audit:security  # static audit of the 20 security rules (docs/SECURITY.md)
npm run verify          # all of the above except test:rls
```

Browser tests for the Studio (they need Chromium and ffmpeg, so they are not part of `npm test`):
`tools/browser-tests/README.md`.

## Layout

```
src/app/(public)   landing page, blog, work-with-me, privacy, terms, cookies, security, accessibility, data-deletion
src/app/(auth)     /login, /signup, /onboarding (Clerk)
src/app/(app)      dashboard, ideas, publish, analytics, deals, revenue, agent, library, ads, studio, connections, settings
src/app/demo       the 10-minute locked demo (sample workspace, no sign-in)
src/app/api        agent, generate, publish (YouTube upload), connect (OAuth), webhooks (Meta), cron, account, contact, demo
src/actions        server actions; every one runs through withCreator()
src/lib            rules engine and agent, integrations (Google, Meta, crypto, publishing), studio, validation, security helpers
supabase/          migrations, upgrade script, SQL tests
tests/             unit tests
tools/             browser test harnesses (Playwright)
scripts/           check-secrets, check-links, security-audit, test-rls, gen-keys
docs/              PRELAUNCH, SECURITY, INTEGRATIONS, AUTH-GOOGLE, CLOUDFLARE, LEGAL-REVIEW, TEAM, 21st-dev
.claude/           project skills and agent definitions used while building (see docs/TEAM.md)
```

## Accessibility

Display settings (text size, contrast, font, reduced motion) are on every page and saved in the browser only. See
`/accessibility` for what has and has not been tested. No screen-reader test has been done yet.

## Known limitations

- Rate limits are in memory per server instance (a speed bump, not a hard cap). Daily AI caps are database-backed.
- The privacy policy, terms and cookie notice are templates. Have them reviewed (`docs/LEGAL-REVIEW.md`).
- Google and Meta apps start in test mode. Public use needs their review processes (`docs/INTEGRATIONS.md`).
- Content-Security-Policy keeps `'unsafe-inline'` for scripts, as the Next.js App Router requires without nonces.
