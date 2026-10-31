# Security checklist: the 20 rules, with evidence

Last executed: 2026-10-29, in the build environment (no network to the package registry, no deployed site).

**How to read this.** *PASS* means a command was run and it passed; the command is named so you can re-run it.
*PASS (static)* means the structure was checked in the source but not exercised against a live system.
*NOT RUN* means it could not be done in the build environment. Nothing here is marked done on trust.

You wrote "20 rules" and listed 20. I told you earlier there were 19. That was my miscount; all 20 are below.

## Commands that produced the evidence

| Command | Result on 2026-10-29 |
| --- | --- |
| `npm test` (`tsx --test tests/*.test.ts`) | **428 / 428 pass** |
| `npm run test:rls` (`bash scripts/test-rls.sh`) | **38 PASS notices**, exit 0, against a scratch Postgres with Supabase stand-ins (`supabase/tests/*.sql`) |
| `npm run check:secrets` | **OK**, 601 files, no secrets, no real `.env` files, client code reads only `NEXT_PUBLIC_` variables |
| `npm run check:links` | **OK**, 64 internal links against 53 routes |
| `npm run audit:security` (`scripts/security-audit.mjs`) | **17 PASS, 0 FAIL, 9 REVIEW, 2 NOT RUN** across 20 rules |
| Typecheck against hand-written stubs | clean. Real library types were not available, so this cannot catch misuse of them |

The audit script was itself tested by breaking a copy of the code on purpose (ownerless delete, action without
`withCreator`, `console.log(token)`, route with no auth, client component importing server code, public private-bucket,
table without RLS). It failed on every one. Removing only one of two `rateLimit` calls in a route is *not* caught,
because the check is "route has a limiter", not "every limiter is present".

## The 20 rules

| # | Rule | How PBOS enforces it | Evidence | Status |
| --- | --- | --- | --- | --- |
| 1 | Hide API keys | Secrets are read only in server files (`import 'server-only'`); the browser sees `NEXT_PUBLIC_` values only. `.env*` is git-ignored; `.env.example` has names, no values. | `check:secrets`; audit rules #1 and #15 (no client component imports server code or reads a secret) | **PASS** |
| 2 | Enable RLS | Every `public` table enables row level security; policies key on `((select auth.jwt()) ->> 'sub')`. | Audit #2 (15 tables, all enabled). `test:rls` groups 1, 10a, 10b, 14, 40: RLS on, anon has no read or write | **PASS** |
| 3 | Test IDOR attacks | Every server action runs in `withCreator()`; every read and write names `creator_id`, and RLS enforces the same boundary underneath. | `test:rls` 3, 4, 18, 42: creator A cannot read, insert, update, delete or reassign B's rows; F cannot forge or approve E's agent actions. Audit #3: 52 actions guarded, 0 ownerless writes | **PASS** (see finding 1) |
| 4 | Scan GIT secrets | `check-secrets.mjs` looks for keys, JWTs and private-key blocks. | `check:secrets` OK on the tree. **This folder is not a git repository**, so history could not be scanned | **PASS for the tree; history NOT RUN** |
| 5 | Lock admin routes | There is no admin surface. The four cron routes require `Authorization: Bearer CRON_SECRET` (24+ characters) and fail closed. | Audit #5: no `/admin` path, 4 of 4 cron routes call the secret check | **PASS (static)** |
| 6 | Test user isolation | RLS plus a one-creator-per-account profile row. | `test:rls` 2, 3, 15, 22, 41: each creator sees only its own rows in all tables, including agent actions and ad drafts | **PASS** |
| 7 | Rate limit API's | `rateLimit()` on every non-cron route and on the costly actions (images, agent, ads, publishing, export, delete, contact). Daily AI caps are stored in the database (`bump_api_usage`). | Audit #7: every non-cron route has a limiter | **PARTIAL.** The limiter is in memory and per serverless instance, so it slows abuse but is not a hard cap. Add Vercel WAF or Cloudflare rules for strict limits (`docs/CLOUDFLARE.md`) |
| 8 | Lock storage buckets | `creator-media` is private (50 MB, video and image types only). `creator-assets` is public **on purpose** and holds only profile photos for the public media kit (2 MB, images only). Both restrict writes and listing to the owner's folder. | `test:rls` 9a, 9b, 21: users write only inside their own folder; audit #8 parses the bucket definitions and fails on any unexpected public bucket | **PASS**, with a deliberate public bucket. Never put anything private there |
| 9 | Validate all inputs | Actions parse form data through `src/lib/validation.ts` rules (length, enum, UUID, date). Route bodies are validated before use. IDs are UUID-checked before queries. | `npm test` (validation, publish-form, generate, ads, studio-edl, agent validate). Audit #9 lists two routes (OAuth callback, demo start) whose inputs are fixed codes or signed values; read both before launch | **PASS (static), 2 to review** |
| 10 | Block unauthenticated routes | Middleware sends signed-out visitors away from all 13 private page folders. Each of the 18 API routes authenticates itself (session, cron secret, webhook signature or demo token) or is on a short public allowlist (contact form, demo start/end), each rate limited and bot-checked. | Audit #10 lists the method each route uses and fails on a route with none | **PASS (static).** Not exercised against a live deployment |
| 11 | Test SQL injection | No raw SQL driver; supabase-js sends parameters. Two PostgREST `.or()` strings interpolate only server-made timestamps. The data-deletion lookup passes a code that is strictly parsed first. | Audit #11; `tests/account.test.ts` and validation tests cover the parsers | **PASS (static).** No injection payloads were sent to a live database |
| 12 | Remove sensitive logs | No `console.log` or `console.debug`. Errors log a label and a database error code, not rows or tokens. | Audit #12: 0 `console.log`; the two logging lines that mention a token name only a column or a setting, not a value | **PASS (static)** |
| 13 | Block field tampering | `creator_id` always comes from the session, never from the form. No form or body is spread into a write. Status transitions are guarded in the database (approval required, no self-published jobs, platform columns server-only). | Audit #13; `test:rls` 18, 18b, 43, 44: forged approvals, rewritten settled actions and bad status pairs are refused | **PASS** |
| 14 | Restrict file uploads | Type allowlist (JPEG, PNG, WebP, MP4, MOV), size cap, a signed one-time upload URL, then the first bytes are checked (`media-sniff.ts`); a file that fails is deleted. Avatars get the same byte check. Bucket limits repeat the size and type rules. | `tests/publish-client.test.ts`: PHP, shell script, Windows executable and SVG are all rejected despite a friendly extension | **PASS** (see finding 2) |
| 15 | Secure server logic | Server modules import `server-only`; the service-role client appears in 12 server files, each of which must scope by creator itself because RLS does not apply to it. Agent change tools never run in the loop; they wait for the creator's click. | Audit #15; `tests/agent-runner.test.ts` ("there is no tool that publishes, approves, sends, pays, submits or deletes") enforces that no tool can do any of those | **PASS (static).** The 12 service-role files are listed by the audit for manual review |
| 16 | Trim API responses | Pages and components never name token or upload-session columns; the agent's data loader selects safe columns only; the account export never selects tokens. | `tests/account.test.ts` ("never selects token or upload-session columns"); `test:rls` 16: token columns are unreadable to the signed-in role; audit #16 | **PASS**, one `select('*')` in `/api/generate` to review |
| 17 | Secure auth sessions | Sign-in and sessions are Clerk's. The cookies PBOS sets itself (demo session, OAuth state) are HttpOnly, Secure, SameSite and signed (HMAC). OAuth tokens are stored AES-256-GCM encrypted with key versions; a plaintext token is rejected by a database check. | `tests/demo-session.test.ts`; `test:rls` 17; audit #17 | **PASS for what PBOS controls.** Clerk's own session handling was not exercised (no keys, no browser sign-in) |
| 18 | Scan dependencies | CI runs `npm audit --audit-level=high` on every push. | The registry is unreachable here, so no scan ran and there is no lockfile yet | **NOT RUN** |
| 19 | Test record access | Reads and writes by id always add the owner; deletes of media check whether an unfinished post still uses the file. | `test:rls` 3, 4, 33, 42; audit #19 | **PASS** |
| 20 | Attack your own app | Needs a running build. A runbook is below. | No `next build` has run and nothing is deployed | **NOT RUN** |

## Findings fixed during this audit

1. **Updates matched on record id alone.** Six database updates (ideas, posts, inquiries) filtered by `id` and relied on RLS
   to stop another creator. RLS does stop it (`test:rls` 3), but defence in depth means the query should say whose record
   it is too. All six now also filter on `creator_id`. The audit now fails any ownerless update or delete in `src/actions`.
2. **Profile photo trusted the browser's file type.** The avatar goes into the one public bucket, and the check used the
   browser's `Content-Type`. It now reads the file's first bytes and rejects anything that is not a real JPEG, PNG or WebP.

## Your live Supabase project, checked 2026-10-31

Read-only checks with the Supabase advisor and catalog queries. Nothing in the live database was changed.

- **Row-level security is on for all 15 tables**, and the project holds no creators, inquiries or files yet.
- **Security advisor: 3 warnings.**
  - `public.idea_owned_by` is callable through the REST API by signed-in users. It only reveals whether an idea id belongs to a
    creator id. `supabase/upgrades/0004_existing_database.sql` moves it out of the exposed schema. **Not applied** (an earlier
    attempt stopped at the confirmation step). The project is empty, so applying it carries no data risk.
  - `public.submit_inquiry(...)` and `public.get_public_media_kit()` are callable by anyone with the public anon key.
    **They are not defined anywhere in this repository.** They come from a migration named `pbos_0009_mvp_operator`, applied
    to the project on 2026-10-28 by something other than this build (the repo's own `0009` is `api_usage_agent`). The
    inquiry function validates input and throttles per email and per day, but it skips the Turnstile check and per-IP limit that
    `/api/contact` applies. This app calls neither function.
    `supabase/upgrades/0010_optional_lock_public_rpc.sql` revokes public access to both. Run it **only if nothing else you
    operate uses them.** It was tested on a scratch database (grants removed, safe to run twice, no-op when the functions do
    not exist).
- **Performance advisor:** 12 warnings that RLS policies call `auth.<function>()` per row (the repo's current policies use the
  `(select auth.jwt())` form, so these come from the old first-version policies and disappear with `0004`), plus 4 foreign keys
  without an index and 6 indexes not yet used (normal on an empty database).
- **Migration drift.** The live project has 9 migrations: the repo's `0001` to `0003`, `0005` to `0008`, `api_usage_agent`,
  and the unknown `pbos_0009_mvp_operator`, which only adds nullable or defaulted columns and the two functions above. This
  repo uses none of those columns, so the app is unaffected, but a fresh project built from this repo will not have them.

## Known limits (not fixed, stated plainly)

- **Rate limiting is best effort** (rule 7). Hard limits need a shared store or a WAF in front.
- **CSP keeps `script-src 'unsafe-inline'`.** Next.js App Router injects inline bootstrap scripts, and a nonce would force
  every page to render dynamically. Everything else is pinned to named origins. The policy has never been loaded in a
  browser with Clerk and Turnstile; check the console on `/login`, `/signup` and `/work-with-me`, and use
  `CSP_REPORT_ONLY=true` while investigating.
- **The service-role key bypasses RLS.** It is used in 12 server files. Each one scopes by creator in code. Treat any new
  use as a security change.
- **The audit script is static.** It reads source text. It cannot prove behaviour at runtime, and a clever refactor could
  slip past its patterns. It is a tripwire for regressions, not a penetration test.
- **No independent review.** A separate reviewer agent hit a usage limit twice and returned nothing. The CodeRabbit CLI
  needs a browser login and was not run. Everything above is the author's own review. Treat it as not independent.
- **Dependencies are unpinned** (`^` ranges) until the first `npm install` creates a lockfile. Commit it.

## Attack runbook for rule 20 (run after the first deploy)

Use two test accounts, A and B, and your deployed URL as `$SITE`. Expected results are in the right column.

| Probe | Expected |
| --- | --- |
| `curl -i $SITE/dashboard` (signed out) | redirect to `/login` |
| `curl -i -X POST $SITE/api/agent/run` and the same for `/api/generate`, `/api/account/export`, `/api/agent/daily` | 401, no body of data |
| `curl -i $SITE/api/cron/publish` with no header, then with a wrong bearer | 401 both times |
| `curl -i -H "Authorization: Bearer <real CRON_SECRET>" $SITE/api/cron/publish` | 200 (only you hold the secret) |
| As A, open a record id that belongs to B (idea, deal, post, media, publish job, agent action) | not found, never B's data |
| As A, call a server action with B's id (replay a request from devtools with B's UUID) | "not found" style failure; nothing changed in B |
| As A, request a signed video URL for B's media id | not found |
| Upload a text file renamed `x.png`, then an HTML file with `Content-Type: image/png` | rejected and removed |
| Upload a 60 MB video | rejected |
| Send 30 rapid requests to `/api/contact` | 429 after the limit; with Turnstile on, 4xx without a token |
| POST to `/api/webhooks/meta` with no or a wrong `X-Hub-Signature-256` | rejected |
| `curl -sI $SITE` | `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, frame protection present |
| Load `/login`, `/signup`, `/work-with-me` with devtools open | no CSP violations in the console |
| `curl $SITE/.well-known/security.txt` | contact and expiry present |
| Sign up a second account while `SINGLE_CREATOR_MODE=true` | refused with the private-mode message |
| Delete a test account | files, rows and the sign-in account gone; `/data-deletion?code=...` reports it |

Record each result here with the date. Until then rule 20 stays **NOT RUN**.
