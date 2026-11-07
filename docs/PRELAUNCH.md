# Pre-launch checklist

Last updated 2026-11-07, against commit `5f62ff3` on `main`. **PASS** means the check was executed and passed. **OPEN** means it
was not run or not finished, and nothing is marked done on trust.

## Executed and passing

| Check | Result | Notes |
| --- | --- | --- |
| Type check (`tsc --noEmit`, app and tests) | **PASS** | Real packages installed in a Vercel sandbox, not stubs. |
| Lint (`next lint`) | **PASS** | 2 warnings (`<img>` in the media grid and the publish composer). |
| Unit tests (`npm test`) | **PASS** 501 / 501 | 43 test files: rules, validation, agent loop and approval gates, OpenAI-compatible (Gemini) client, free image provider, Google/Meta clients, publishing, analytics, security helpers, contrast, column-grant guard. |
| Secrets scan (`npm run check:secrets`) | **PASS** | 637 files, no keys, no real `.env` files, client code reads only `NEXT_PUBLIC_` variables. |
| Internal links (`npm run check:links`) | **PASS** | 80 links and redirects against 66 routes. |
| Security audit script (`npm run audit:security`) | **17 PASS, 0 FAIL, 9 REVIEW, 2 NOT RUN** | Across all 20 rules in `docs/SECURITY.md`. REVIEW items need a human decision; NOT RUN items are the live probes below. |
| Production build | **PASS** | `next build` succeeds on Vercel (production deployment READY on `main`). |
| Database writes as the signed-in role | **PASS** | Run against the live Supabase project as the `authenticated` role, rolled back: revenue invoices, ad drafts and the publish-job update. This found and fixed two real bugs (select `*` and an ungranted column) that showed as "Could not save to the database". |
| Gmail send | **PASS (once)** | The agent sent one approved email through the creator's Gmail; the stored record reads "Gmail accepted it". |
| YouTube and Gmail connections | **PASS** | Both connected and `active` on the live project. |
| AI connection | **PASS** | The in-app "Test the AI connection" passed against Gemini (plain request and the agent's 20 tools). |
| Free image generation | **PASS** | A live request returned a valid 832x1040 JPEG in about 5 seconds. The service allows one image per 45 seconds per shared IP, so PBOS waits and retries. |

## OPEN: needs you or a real environment

| Item | Status | What to do |
| --- | --- | --- |
| Agent end to end on Gemini | **PARTLY** | Multi-turn tool calls were fixed for Gemini (thought signatures, function names) but a full agent run reading and writing records has not been confirmed on the live key. Run `/agent` and ask for something that needs your records. |
| Publishing to YouTube | **NOT RUN** | No video has been published. Approve a draft, then choose the video file on the Publish page. |
| Instagram | **NOT RUN** | Needs `META_APP_ID` and `META_APP_SECRET`. Nothing has run against a real Instagram account. |
| Agent web search | **LIMITED** | Works only with an `ANTHROPIC_API_KEY`. Not available on the Gemini provider. |
| Scheduled jobs | **NOT RUN** | Add the GitHub secrets `PBOS_URL` and `CRON_SECRET` (same value as in Vercel). |
| Lockfile and `npm ci` | **OPEN** | Run the "Lockfile" workflow once, then switch CI to `npm ci`. |
| Live security probes | **NOT RUN** | Run the probes in `docs/SECURITY.md` against the deployed site. |
| Independent code review | **NOT DONE** | No separate reviewer has read the auth, middleware, contact-route and agent code. CodeRabbit needs its CLI and a browser login, which were not available here. |
| Accessibility on real devices | **NOT RUN** | Automated contrast checks pass. A screen-reader pass has not been done. |
| Clerk sign-up mode | **OPEN** | Three creator profiles exist in the database. If this should be a private instance, set Clerk sign-up to Restricted or set `SINGLE_CREATOR_MODE`. |
| Google app in testing mode | **OPEN** | Sign-ins expire after 7 days and only listed test users can connect until the Google app is verified. |
| Ad drafts and revenue in the live app | **UNCONFIRMED** | Database writes pass. The creator reported failures; the exact messages are needed to find the cause. |
