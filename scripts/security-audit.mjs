#!/usr/bin/env node
/**
 * Static security audit for PBOS. No dependencies, no network, writes nothing.
 *
 *   node scripts/security-audit.mjs          human-readable report
 *   node scripts/security-audit.mjs --json   machine-readable report
 *
 * It reads the source tree and checks structural rules that an attacker would probe first:
 * who can reach each route, whether every write is scoped to its owner, whether server-only
 * code can leak into the browser, and whether logs or responses carry secrets.
 *
 * What this is NOT: a penetration test. It cannot prove a rule holds at runtime. Checks that
 * need a live database, a registry or a browser are reported as NOT RUN or are covered by the
 * separate suites named in docs/SECURITY.md (supabase/tests, tests/*.test.ts).
 *
 * Exit code: 1 when any check FAILS, otherwise 0. REVIEW and NOT RUN never fail the build, but
 * they are printed so nothing is silently marked done.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const asJson = process.argv.includes('--json');

/** Recursively list files under `dir` whose names match `re`, skipping build and vendor folders. */
function walk(dir, re, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', '.out', 'fixtures'].includes(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, re, out);
    else if (re.test(name)) out.push(full);
  }
  return out;
}

const rel = (p) => relative(ROOT, p).split(sep).join('/');
const read = (p) => readFileSync(p, 'utf8');
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

const srcFiles = walk(join(ROOT, 'src'), /\.(ts|tsx|mjs)$/);
const sqlFiles = [...walk(join(ROOT, 'supabase', 'migrations'), /\.sql$/), ...walk(join(ROOT, 'supabase', 'upgrades'), /\.sql$/)];

/** @type {Array<{n:number,rule:string,check:string,status:'PASS'|'FAIL'|'REVIEW'|'NOT RUN',detail:string[]}>} */
const results = [];
function record(n, rule, check, status, detail = []) {
  results.push({ n, rule, check, status, detail });
}

/* ---------- 2. Enable RLS ---------- */
{
  const tables = new Map(); // name -> file
  const rls = new Set();
  for (const f of sqlFiles) {
    const sql = read(f);
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)) tables.set(m[1], rel(f));
    for (const m of sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?public\.(\w+)\s+enable\s+row\s+level\s+security/gi)) rls.add(m[1]);
  }
  const without = [...tables.keys()].filter((t) => !rls.has(t));
  record(2, 'Enable RLS', `every public table enables row level security (${tables.size} tables)`, without.length ? 'FAIL' : 'PASS', without.map((t) => `no ENABLE ROW LEVEL SECURITY for public.${t} (${tables.get(t)})`));
}

/* ---------- 8. Lock storage buckets ---------- */
{
  // Buckets that are public ON PURPOSE, with the reason. Anything else must be private.
  const PUBLIC_ON_PURPOSE = { 'creator-assets': 'profile photos shown on the public media kit (images only, 2 MB cap, owner-only write/list)' };
  const buckets = []; // { id, isPublic, file }
  for (const f of sqlFiles) {
    const sql = read(f);
    for (const m of sql.matchAll(/insert\s+into\s+storage\.buckets\s*\(([^)]*)\)\s*values\s*\(([\s\S]*?)\)\s*(?:on\s+conflict|;)/gi)) {
      const cols = m[1].split(',').map((c) => c.trim().toLowerCase());
      const head = m[2].split(/array\s*\[/i)[0].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
      const id = head[cols.indexOf('id')];
      const pub = head[cols.indexOf('public')];
      buckets.push({ id, isPublic: pub === 'true', file: rel(f), hasLimit: /file_size_limit/i.test(m[1]), hasMime: /allowed_mime_types/i.test(m[1]) });
    }
  }
  const problems = [];
  if (!buckets.length) problems.push('no bucket definitions found in supabase/migrations');
  for (const b of buckets) {
    if (b.isPublic && !PUBLIC_ON_PURPOSE[b.id]) problems.push(`bucket "${b.id}" is public (${b.file}) and is not on the allowlist`);
    if (!b.hasLimit) problems.push(`bucket "${b.id}" has no file_size_limit`);
    if (!b.hasMime) problems.push(`bucket "${b.id}" has no allowed_mime_types`);
  }
  const policies = sqlFiles.map(read).join('\n');
  if (!/storage\.foldername\s*\(\s*name\s*\)/i.test(policies)) problems.push('policies do not scope objects to the owner folder (storage.foldername)');
  record(8, 'Lock storage buckets', `buckets private unless allowlisted, size and type limits, owner-folder policies (${buckets.length} buckets)`, problems.length ? 'FAIL' : 'PASS', problems);
  const open = buckets.filter((b) => b.isPublic).map((b) => `"${b.id}" is public on purpose: ${PUBLIC_ON_PURPOSE[b.id] ?? 'NOT ALLOWLISTED'}. Anyone with the file URL can fetch it; never store anything private there.`);
  if (open.length) record(8, 'Lock storage buckets', 'public buckets are deliberate and contain nothing private', 'REVIEW', open);
}

/* ---------- 5, 10, 7. Routes: auth, admin/cron, rate limits ---------- */
const routeFiles = srcFiles.filter((f) => /[\\/]app[\\/]api[\\/].*route\.ts$/.test(f));
const AUTH_MARKERS = {
  session: /getCreatorContext|requireCreator|currentUser\(|auth\(\)/,
  cron: /authorizeCron|cron-auth/,
  webhook: /x-hub-signature|verifyMetaSignature|signed_request|verifySignature|META_WEBHOOK_VERIFY_TOKEN/i,
  demo: /decideDemoAccess|DEMO_COOKIE|demo-session/,
  public: /turnstile|verifyTurnstile/i,
};
const PUBLIC_ALLOWLIST = new Set([
  // Anyone can send a contact message or start the time-boxed demo; both are rate limited and bot-checked.
  'src/app/api/contact/route.ts',
  'src/app/api/demo/start/route.ts',
  'src/app/api/demo/end/route.ts',
]);
{
  const unauth = [];
  const lines = [];
  const noLimit = [];
  for (const f of routeFiles) {
    const text = read(f);
    const kinds = Object.entries(AUTH_MARKERS).filter(([, re]) => re.test(text)).map(([k]) => k);
    const r = rel(f);
    const isCron = r.includes('/api/cron/');
    lines.push(`${r}: ${kinds.length ? kinds.join('+') : 'NONE'}`);
    if (!kinds.length && !PUBLIC_ALLOWLIST.has(r)) unauth.push(`${r} has no recognised authentication`);
    if (!/rateLimit\(/.test(text) && !isCron && !/cron|demo\/end/.test(r)) noLimit.push(r);
  }
  record(10, 'Block unauthenticated routes', `every API route authenticates, or is on the public allowlist (${routeFiles.length} routes)`, unauth.length ? 'FAIL' : 'PASS', unauth.length ? unauth : lines);

  const cronRoutes = routeFiles.filter((f) => rel(f).includes('/api/cron/'));
  const weakCron = cronRoutes.filter((f) => !AUTH_MARKERS.cron.test(read(f))).map((f) => `${rel(f)} does not call the cron secret check`);
  const adminish = srcFiles.filter((f) => /[\\/](admin)[\\/]/.test(f) && !f.includes(`${sep}supabase${sep}admin`)).map(rel);
  record(5, 'Lock admin routes', `no /admin surface; all ${cronRoutes.length} cron routes check CRON_SECRET`, weakCron.length || adminish.length ? 'FAIL' : 'PASS', [...weakCron, ...adminish.map((f) => `unexpected admin path: ${f}`)]);

  record(7, 'Rate limit API’s', 'every non-cron route calls rateLimit()', noLimit.length ? 'FAIL' : 'PASS', noLimit.map((r) => `${r} has no rateLimit()`));
  record(7, 'Rate limit API’s', 'limiter is shared across serverless instances', 'REVIEW', [
    'src/lib/server/rate-limit.ts is in-memory and per instance. It slows casual abuse and runaway AI spend but is not a hard limit.',
    'Daily AI caps are database-backed through bump_api_usage (agent runs and images). Put Vercel WAF or Cloudflare rate rules in front for strict limits (docs/CLOUDFLARE.md).',
  ]);
}

/* ---------- 10 (pages). Private pages are behind the middleware matcher ---------- */
{
  const mw = read(join(ROOT, 'src', 'middleware.ts'));
  const appDirs = existsSync(join(ROOT, 'src/app/(app)')) ? readdirSync(join(ROOT, 'src/app/(app)')).filter((d) => statSync(join(ROOT, 'src/app/(app)', d)).isDirectory()) : [];
  const missing = appDirs.filter((d) => !new RegExp(`['/(|]${d}[|)(']`).test(mw) && !mw.includes(`/${d}(`));
  record(10, 'Block unauthenticated routes', `every private page folder is in the middleware matcher (${appDirs.length} folders)`, missing.length ? 'FAIL' : 'PASS', missing.map((d) => `/${d} is not listed in src/middleware.ts`));
}

/* ---------- 9, 3, 19, 13. Server actions ---------- */
const actionFiles = srcFiles.filter((f) => /[\\/]src[\\/]actions[\\/]/.test(f));
{
  const notUseServer = [];
  const unguarded = [];
  const writesWithoutOwner = [];
  const spreads = [];
  let fnCount = 0;
  for (const f of actionFiles) {
    const text = read(f);
    if (!/^\s*(['"])use server\1/.test(text)) notUseServer.push(rel(f));
    for (const m of text.matchAll(/export\s+async\s+function\s+(\w+)/g)) {
      fnCount++;
      const body = text.slice(m.index, m.index + 700);
      if (!/withCreator\b|getCreatorContext\(|requireCreator\(|getSessionContext\(/.test(body)) unguarded.push(`${rel(f)}:${lineOf(text, m.index)} ${m[1]} does not start with withCreator()`);
    }
    // Writes must name the owner. Look at each .update( / .delete( statement up to its terminating semicolon.
    for (const m of text.matchAll(/\.(update|delete)\(/g)) {
      const start = text.lastIndexOf(';', m.index) + 1;
      const stmt = text.slice(start, text.indexOf(';', m.index) + 1 || m.index + 600);
      if (!/\.from\(\s*['"`]/.test(stmt)) continue; // not a database write (store method, crypto, etc.)
      // Owner filter: creator_id / user_id, or the creator's own profile row (.eq('id', profile.id)).
      if (!/creator_id|user_id|\.eq\(\s*'id'\s*,\s*profile\.id\s*\)/.test(stmt)) writesWithoutOwner.push(`${rel(f)}:${lineOf(text, m.index)} ${m[1]} without an owner filter`);
    }
    if (/\.(insert|update|upsert)\(\s*(\{\s*)?\.\.\.(input|body|form|formData|payload|raw|data)\b/.test(text) || /Object\.fromEntries\(\s*formData/.test(text)) spreads.push(rel(f));
  }
  record(3, 'Test IDOR attacks', `every server action (${fnCount}) runs inside withCreator() or checks the session first`, notUseServer.length || unguarded.length ? 'FAIL' : 'PASS', [...notUseServer.map((f) => `${f} is missing 'use server'`), ...unguarded]);
  record(3, 'Test IDOR attacks', 'every update/delete in actions names the owner (creator_id)', writesWithoutOwner.length ? 'FAIL' : 'PASS', writesWithoutOwner);
  record(13, 'Block field tampering', 'no raw form or body spread straight into insert/update', spreads.length ? 'FAIL' : 'PASS', spreads.map((f) => `${f} spreads client input into a write`));
}

/* ---------- 3/19 library-level writes ---------- */
{
  const libWrites = [];
  for (const f of srcFiles.filter((p) => /[\\/]src[\\/]lib[\\/](server|integrations|agent)[\\/]/.test(p) || /[\\/]src[\\/]app[\\/]api[\\/]/.test(p))) {
    const text = read(f);
    for (const m of text.matchAll(/\.(update|delete)\(/g)) {
      const start = text.lastIndexOf(';', m.index) + 1;
      const stmt = text.slice(start, text.indexOf(';', m.index) + 1 || m.index + 600);
      if (!/\.from\(\s*['"`]/.test(stmt)) continue; // crypto ciphers, rate-limit maps, store method calls
      if (!/creator_id|user_id|\.eq\(\s*'id'/.test(stmt)) libWrites.push(`${rel(f)}:${lineOf(text, m.index)}`);
    }
  }
  record(19, 'Test record access', 'server-side updates/deletes outside actions carry an owner or id filter', libWrites.length ? 'REVIEW' : 'PASS', libWrites.map((l) => `${l} write without creator_id/user_id/id in the statement`));
}

/* ---------- 15. Secure server logic ---------- */
{
  const serverDir = join(ROOT, 'src', 'lib', 'server');
  // These two are pure functions: they read no environment and take secrets as arguments. Unit tests import them,
  // and `server-only` would make that impossible. They hold nothing a browser could abuse.
  const PURE = new Set(['src/lib/server/client-ip.ts', 'src/lib/server/turnstile.ts']);
  const missingServerOnly = walk(serverDir, /\.ts$/).filter((f) => !PURE.has(rel(f)) && !/import\s+['"]server-only['"]/.test(read(f))).map((f) => `${rel(f)} lacks import 'server-only'`);
  const pureProblems = [...PURE].filter((f) => existsSync(join(ROOT, f)) && /process\.env/.test(read(join(ROOT, f)))).map((f) => `${f} is on the pure allowlist but reads process.env`);
  const leaks = [];
  for (const f of srcFiles) {
    const text = read(f);
    if (!/^\s*(['"])use client\1/.test(text)) continue;
    if (/from\s+['"]@\/lib\/(server|supabase\/admin)/.test(text)) leaks.push(`${rel(f)} is a client component importing server-only code`);
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') leaks.push(`${rel(f)} reads ${m[1]} in the browser`);
  }
  const adminUsers = srcFiles.filter((f) => /supabase\/admin/.test(read(f)) && !f.endsWith(`supabase${sep}admin.ts`)).map(rel);
  const adminFile = read(join(ROOT, 'src/lib/supabase/admin.ts'));
  const adminProblems = /server-only/.test(adminFile) ? [] : ['src/lib/supabase/admin.ts lacks import \'server-only\''];
  record(15, 'Secure server logic', 'server modules are marked server-only; no client component imports them or reads secrets', missingServerOnly.length || leaks.length || adminProblems.length || pureProblems.length ? 'FAIL' : 'PASS', [...missingServerOnly, ...leaks, ...adminProblems, ...pureProblems]);
  record(15, 'Secure server logic', `service-role client used in ${adminUsers.length} server files (each must scope by creator manually, RLS does not apply)`, 'REVIEW', adminUsers);
}

/* ---------- 12. Remove sensitive logs ---------- */
{
  const noisy = [];
  const sensitive = [];
  for (const f of srcFiles) {
    const text = read(f);
    for (const m of text.matchAll(/console\.(log|info|debug|warn|error)\(([^;]*)\)?;/g)) {
      const l = `${rel(f)}:${lineOf(text, m.index)}`;
      if (m[1] === 'log' || m[1] === 'debug' || (m[1] === 'info' && /\$\{/.test(m[2]))) noisy.push(`${l} console.${m[1]}`);
      if (/(token|secret|password|authorization|cookie|api[_-]?key|bearer|refresh)/i.test(m[2]) && !/['"`][^'"`]*(token|secret|key)[^'"`]*['"`]\s*[,)]?\s*$/.test(m[2].split(',')[0])) sensitive.push(`${l} ${m[0].slice(0, 110)}`);
    }
  }
  record(12, 'Remove sensitive logs', 'no console.log/debug left in src, and console.info never interpolates a value', noisy.length ? 'FAIL' : 'PASS', noisy);
  record(12, 'Remove sensitive logs', 'no console call mentions a token, secret, cookie or password variable', sensitive.length ? 'REVIEW' : 'PASS', sensitive);
}

/* ---------- 16. Trim API responses ---------- */
{
  const tokenCols = ['access_token_enc', 'refresh_token_enc', 'token_enc', 'upload_session', 'upload_url'];
  const clientFacing = srcFiles.filter((f) => /[\\/]src[\\/](app[\\/](\(app\)|\(public\)|demo)|components)[\\/]/.test(f));
  const leaks = [];
  for (const f of clientFacing) {
    const text = read(f);
    for (const col of tokenCols) if (new RegExp(`['"\`, ]${col}\\b`).test(text)) leaks.push(`${rel(f)} references ${col}`);
  }
  const starSelects = [];
  for (const f of srcFiles.filter((p) => /[\\/]app[\\/]api[\\/]/.test(p))) {
    const text = read(f);
    for (const m of text.matchAll(/select\(\s*['"]\*['"]/g)) starSelects.push(`${rel(f)}:${lineOf(text, m.index)}`);
  }
  record(16, 'Trim API responses', 'no page or component names a token or upload-session column', leaks.length ? 'FAIL' : 'PASS', leaks);
  record(16, 'Trim API responses', 'API routes do not select("*")', starSelects.length ? 'REVIEW' : 'PASS', starSelects.map((l) => `${l} select('*') in a route handler: confirm the response is trimmed`));
}

/* ---------- 14. Restrict file uploads ---------- */
{
  const problems = [];
  const sniff = existsSync(join(ROOT, 'src/lib/media-sniff.ts'));
  if (!sniff) problems.push('src/lib/media-sniff.ts (content sniffing) is missing');
  const publish = existsSync(join(ROOT, 'src/actions/publish.ts')) ? read(join(ROOT, 'src/actions/publish.ts')) : '';
  if (!/MAX_|maxBytes|size/i.test(publish)) problems.push('src/actions/publish.ts has no size check');
  if (!/mime|content_type|contentType/i.test(publish)) problems.push('src/actions/publish.ts has no type check');
  record(14, 'Restrict file uploads', 'type allowlist, size cap and content sniffing exist for uploads', problems.length ? 'FAIL' : 'PASS', problems);
}

/* ---------- 17. Secure auth sessions ---------- */
{
  const cookieSets = [];
  for (const f of srcFiles) {
    const text = read(f);
    for (const m of text.matchAll(/cookies\(\)\.set\(|\.cookies\.set\(|Set-Cookie/g)) {
      const stmt = text.slice(m.index, m.index + 400);
      if (/maxAge:\s*0/.test(stmt)) continue; // expiring a cookie, nothing to protect
      const flags = ['httpOnly', 'secure', 'sameSite'].filter((k) => new RegExp(k, 'i').test(stmt));
      cookieSets.push({ where: `${rel(f)}:${lineOf(text, m.index)}`, flags });
    }
  }
  const weak = cookieSets.filter((c) => c.flags.length < 3).map((c) => `${c.where} sets a cookie without ${['httpOnly', 'secure', 'sameSite'].filter((k) => !c.flags.includes(k)).join(', ')}`);
  record(17, 'Secure auth sessions', `cookies PBOS sets itself are HttpOnly + Secure + SameSite (${cookieSets.length} found); sign-in cookies are managed by Clerk`, weak.length ? 'FAIL' : 'PASS', weak);
}

/* ---------- 9. Validate all inputs (route bodies) ---------- */
{
  const unvalidated = [];
  for (const f of routeFiles) {
    const text = read(f);
    if (!/request\.json\(|req\.json\(|formData\(|searchParams/.test(text)) continue;
    if (!/validate|parse|safeParse|isString|typeof\s+\w+\s*===|Number\.isFinite|\.test\(|z\./.test(text)) unvalidated.push(rel(f));
  }
  record(9, 'Validate all inputs', 'every route that reads a body or query shows validation code', unvalidated.length ? 'REVIEW' : 'PASS', unvalidated);
}

/* ---------- 11. SQL injection ---------- */
{
  const rawSql = [];
  const interpolatedFilters = [];
  for (const f of srcFiles) {
    const text = read(f);
    if (/\b(pg|postgres|knex|sequelize)\b.*from\s+['"]/.test(text) || /\.query\(\s*`/.test(text)) rawSql.push(rel(f));
    for (const m of text.matchAll(/\.(or|filter|ilike|like)\(\s*`[^`]*\$\{([^}]+)\}/g)) interpolatedFilters.push(`${rel(f)}:${lineOf(text, m.index)} interpolates ${m[2].trim()}`);
  }
  record(11, 'Test SQL injection', 'no raw SQL driver or string-built query in the app (supabase-js sends parameters)', rawSql.length ? 'FAIL' : 'PASS', rawSql);
  record(11, 'Test SQL injection', 'PostgREST .or()/.filter() strings never include user input', interpolatedFilters.length ? 'REVIEW' : 'PASS', interpolatedFilters.map((l) => `${l} (confirm it is server-generated, e.g. an ISO timestamp)`));
}

/* ---------- 1, 4. Keys and git secrets: delegate to check-secrets ---------- */
{
  const gi = existsSync(join(ROOT, '.gitignore')) ? read(join(ROOT, '.gitignore')) : '';
  const problems = [];
  if (!/^\.env/m.test(gi)) problems.push('.gitignore does not ignore .env files');
  const envFiles = readdirSync(ROOT).filter((n) => /^\.env(\.|$)/.test(n) && n !== '.env.example');
  for (const n of envFiles) problems.push(`${n} exists in the project folder: it must not be shipped`);
  record(1, 'Hide API keys', '.env files are git-ignored and none is shipped (client-code check: node scripts/check-secrets.mjs)', problems.length ? 'FAIL' : 'PASS', problems);
  record(4, 'Scan GIT secrets', 'run `node scripts/check-secrets.mjs` (patterns for keys, JWTs, private keys); a full-history scan needs a git repo', 'REVIEW', ['This folder is not a git repository yet, so history cannot be scanned. After the first push run a history scan (gitleaks or GitHub secret scanning).']);
}

/* ---------- 18. Dependencies ---------- */
{
  const pkg = JSON.parse(read(join(ROOT, 'package.json')));
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  const lock = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].find((n) => existsSync(join(ROOT, n)));
  record(18, 'Scan dependencies', `npm audit against the registry (${Object.keys(all).length} direct packages)`, 'NOT RUN', [
    'The package registry is not reachable from the build environment, so no advisory scan was possible.',
    lock ? `Lockfile present: ${lock}.` : 'No lockfile yet: run `npm install` once and commit package-lock.json, then `npm audit --omit=dev`. CI (.github/workflows/ci.yml) runs it on every push.',
  ]);
}

/* ---------- 6, 20. Need a database / a running app ---------- */
record(6, 'Test user isolation', 'cross-creator reads and writes are denied by RLS (bash scripts/test-rls.sh, supabase/tests/*.sql)', existsSync(join(ROOT, 'supabase/tests/10_rls.test.sql')) ? 'REVIEW' : 'FAIL', ['Executed separately against a real Postgres; see docs/SECURITY.md for the last recorded result.']);
record(20, 'Attack your own app', 'live probes of a deployed build (auth bypass, header checks, CSP in a browser)', 'NOT RUN', ['No `next build` has run yet and no deployment exists, so nothing could be attacked live. Run the probes in docs/SECURITY.md after the first deploy.']);

/* ---------- report ---------- */
results.sort((a, b) => a.n - b.n);
const failed = results.filter((r) => r.status === 'FAIL');
if (asJson) {
  console.log(JSON.stringify({ results, failed: failed.length }, null, 2));
} else {
  console.log('PBOS static security audit\n');
  for (const r of results) {
    console.log(`[${r.status.padEnd(7)}] #${String(r.n).padStart(2)} ${r.rule}: ${r.check}`);
    for (const d of r.detail) console.log(`            ${d}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('REVIEW')} REVIEW, ${count('NOT RUN')} NOT RUN across ${new Set(results.map((r) => r.n)).size} of 20 rules.`);
}
process.exit(failed.length ? 1 : 0);
