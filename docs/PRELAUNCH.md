# Pre-launch checklist

Status as of the last build session. **PASS** means the check was actually executed and passed in that session.
**NOT RUN** means it could not be executed there, and nothing is marked done on trust. Re-run or complete every
NOT RUN and OPEN item before you call this launched.

## Executed and passing

| Check | Result | Notes |
| --- | --- | --- |
| Unit tests (`npm test`) | **PASS** 140 / 140 | Rules engine, validation, revenue maths, generation, security helpers, landing-page scroll maths. |
| Row-level security and constraints (`npm run test:rls`) | **PASS** 13 groups | Scratch PostgreSQL with Supabase stand-ins. Covers: cross-creator reads and writes blocked, anon blocked, no-token requests blocked, user id read from the token, storage folders, append-only event log. |
| Upgrade path (old policies, then `supabase/upgrades/0004`) | **PASS** 13 groups | Same tests, run on a database upgraded from the first migration version. |
| Row-level security on the real Supabase project | **PASS** | Rollback-only check on the restored project: user id defaults from the token, a user sees only their own rows, cannot write into another creator, anon is blocked. Nothing stored. |
| Secrets scan (`npm run check:secrets`) | **PASS** | No keys or JWTs in the tree, no real `.env` files, client code reads only `NEXT_PUBLIC_` variables. The script was also shown to catch planted problems. |
| Internal links (`npm run check:links`) | **PASS** | 39 links and redirects against 21 routes. Also shown to catch a planted broken link. |
| Typecheck | **PASS, with a caveat** | Run against hand-written type stubs for React, Next, Clerk and Supabase, because packages could not be installed. It cannot catch misuse of those libraries' real types. |
| Landing page, desktop, mobile and reduced motion | **PASS** | Checked in headless Chromium with the app's CSS. This was not a `next build` render. |

## OPEN: needs you or a real environment

| Item | Status | What to do |
| --- | --- | --- |
| `npm install`, `next build`, `next lint` | **NOT RUN** | The package registry was unreachable in the build session. The first real build will be on Vercel or your machine. Run `npm run verify` there. |
| CodeRabbit review | **NOT RUN** | The CodeRabbit CLI was not installed in the session and needs a browser login. Run it yourself: `git init && git add -A && git commit -m init`, then `coderabbit auth login` and `coderabbit review --agent --base-commit <first commit>` (or open a pull request with the CodeRabbit GitHub app installed). `.coderabbit.yaml` is included. |
| Independent code review | **NOT COMPLETED** | A separate reviewer agent hit a usage limit and returned nothing. Only the author's own review of auth, middleware, contact route and security code was done. Treat it as not independent. |
| Supabase upgrade `supabase/upgrades/0004_existing_database.sql` | **OPEN** | Cancelled at the tool's confirmation step, so the live database still has the first policy version. The live Supabase advisors report 1 security warning (helper function callable through the REST API; it only reveals whether an idea id belongs to a creator id) and 12 performance warnings (policy form). Both disappear after this file runs. |
| Clerk ↔ Supabase connection | **NOT RUN** | Needs the two dashboard steps in the README. Until then every signed-in database call fails and the app shows an error. |
| Clerk keys and a real sign-in | **NOT RUN** | No keys were available. Sign-in, sign-up, onboarding redirect and sign-out have not been exercised in a browser. |
| Clerk sign-up mode | **OPEN** | Set to **Restricted** in the Clerk Dashboard after creating your account. |
| Content-Security-Policy in a real browser | **NOT RUN** | Written to Clerk's and Cloudflare's documented requirements but never loaded with them. Check the console on `/login`, `/signup`, `/work-with-me`. Use `CSP_REPORT_ONLY=true` to investigate. |
| Turnstile end to end | **NOT RUN** | Server-side verification logic is unit-tested with a fake Cloudflare. The widget and a real token have not been tried. |
| Cloudflare proxy, WAF and rate-limit rules | **OPEN** | Dashboard-only. Nothing in the code can enable them. |
| GitHub repository and Vercel deployment | **OPEN** | Not done. The GitHub token available in the session was invalid and a repository could not be created. |
| Accessibility audit with a screen reader | **NOT RUN** | Forms use labels, visible focus, `aria-hidden` on decoration and a flat fallback for reduced motion. No assistive-technology test was done. |
| Legal pages | **OPEN** | `/privacy` and `/terms` are templates. Have them reviewed. |

## Product rules: where each is enforced

| Rule | Where |
| --- | --- |
| Nothing is posted or sent automatically | No integration exists. Outreach and follow-ups are drafts shown for review. |
| No invented numbers | Empty states in each page; revenue forecasts carry `FORECAST_LABEL` ("Estimate, not guaranteed income."). |
| Recommendations cite a source | `src/lib/agent/validate.ts` rejects model output without a real source record or stated goal. |
| One creator | Clerk Restricted mode (manual), `src/lib/server/signup-guard.ts` (code), RLS scoping (database). |
| AI is disclosed | Persona settings and draft headers say a draft is AI-written. |
