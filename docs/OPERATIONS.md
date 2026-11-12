# Operations: limits, monitoring, backups, load

What protects PBOS in production, what is free, and what only you can switch on.

## Limits and spending caps (all free to run)
| Layer | Where | Default |
|---|---|---|
| Per-minute limits on every sensitive action and API route | `src/lib/server/rate-limit.ts` (per server instance, best effort) | varies |
| Per-creator daily allowance: images, scene pictures, agent runs, searches, emails | `bump_api_usage` (atomic, in the database) | images 20, scene pictures 30 (`VIDEO_IMAGE_DAILY_LIMIT`) |
| **Shared daily ceiling across all creators** for images and agent runs | `src/lib/server/budget.ts` | **3000 units per UTC day**, `PBOS_GLOBAL_DAILY_LIMIT` (0 turns it off) |
| Upload size | 50 MB per file, enforced in the app and by the storage bucket | fixed |
| Double-click / retry protection | same content within 4 s is saved once (ideas, deals, invoices, posts) | fixed |

Nothing in PBOS takes payments or subscriptions, so there is nothing to duplicate there. To cap spending on a paid AI key, set a monthly budget in that provider's dashboard as well: it is the only hard stop.

## Uptime monitoring (free)
`/api/health` answers 200 when the app and database respond and 503 when the database does not. `.github/workflows/uptime.yml` calls it every 10 minutes using the `PBOS_URL` secret and fails (GitHub emails you) after three failed tries. Optional second opinion: UptimeRobot's free plan, pointed at `https://your-domain/api/health`.

## Error logging
Server errors are written to Vercel runtime logs (Vercel dashboard > project > Logs, or the Vercel MCP `get_runtime_errors`). Provider failures are also written to the `integration_events` table (secrets are blocked by a database constraint). There is no third-party error tracker: Sentry's free plan can be added later if you want alerts by email.

## Load test (simultaneous visitors)
```
node scripts/load-test.mjs https://your-domain 25 20
```
Runs 25 parallel visitors for 20 seconds against public pages only and prints requests per second, errors and p50/p95/p99 latency. It exits non-zero if more than 1% fail. Signed-in pages need a login and are not covered. Record the result in `docs/PRELAUNCH.md`.

## Backups and restore test
Supabase's free plan does not give you downloadable backups, so take your own:
1. `SUPABASE_DB_URL='postgresql://…session pooler…' ./scripts/backup-db.sh` (needs `pg_dump` 15+). It checks the file is readable.
2. **Restore test (do this once, before trusting the backup):** create a second free Supabase project, then
   `pg_restore --no-owner --no-privileges --dbname "<second project URL>" backups/pbos-….dump`
   and check that row counts in `creator_profile`, `ideas`, `deals` match the original. Then delete the second project.
3. Run the backup weekly and keep the last few copies somewhere private (the file holds user data and encrypted tokens). Never commit it: `backups/` is git-ignored.

Not yet done: the restore test has not been run (it needs a database password and a second project that only you can create).
