#!/usr/bin/env node
// Fails if the project would ship a secret or leak a server-only value to the browser.
// Prints file:line and the kind of finding, never the matched value.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.vercel', 'coverage']);
const TEXT_EXT = /\.(?:[cm]?[jt]sx?|json|md|mdx|ya?ml|toml|sql|sh|css|html|txt|env|example|d\.mts|mjs)$|(?:^|\/)\.[a-z]+(?:rc|ignore)?$/i;

const PATTERNS = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Clerk secret key', /\bsk_(?:test|live)_[A-Za-z0-9]{20,}/],
  ['Supabase secret key', /\bsb_secret_[A-Za-z0-9_-]{20,}/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/],
  ['Private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
];

const findings = [];
const add = (file, line, kind) => findings.push(`${file}:${line}  ${kind}`);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.size < 2_000_000) yield full;
  }
}

/** A Supabase service-role key is a JWT whose payload says role=service_role. */
function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.role;
  } catch {
    return null;
  }
}

const files = [...walk(ROOT)];

for (const file of files) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const base = rel.split('/').pop();

  // 1. No real environment files in the tree (only the template).
  if (/^\.env(\..+)?$/.test(base) && base !== '.env.example') add(rel, 1, 'environment file must not be shipped');

  if (!TEXT_EXT.test(base) && !/^\.env/.test(base)) continue;
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    for (const [kind, re] of PATTERNS) if (re.test(line)) add(rel, i + 1, kind);
    for (const m of line.matchAll(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
      const role = jwtRole(m[0]);
      if (role === 'service_role') add(rel, i + 1, 'Supabase service-role JWT');
      else if (role) add(rel, i + 1, `JWT with role "${role}" committed (use an environment variable)`);
    }
  });

  // 2. .env.example must hold no values for secret settings.
  if (base === '.env.example') {
    lines.forEach((line, i) => {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && /(SECRET|SERVICE_ROLE|API_KEY|TOKEN|PASSWORD)/.test(m[1]) && m[2].trim() !== '') add(rel, i + 1, `${m[1]} must be empty in .env.example`);
    });
  }

  // 3. A secret must never be exposed through a NEXT_PUBLIC_ variable.
  lines.forEach((line, i) => {
    if (/NEXT_PUBLIC_[A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE)/.test(line)) add(rel, i + 1, 'NEXT_PUBLIC_ variable name suggests a secret');
  });

  // 4. Browser code may only read NEXT_PUBLIC_ variables.
  if (/^src\/.*\.tsx?$/.test(rel) && /^\s*['"]use client['"]/.test(text)) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        if (!m[1].startsWith('NEXT_PUBLIC_') && m[1] !== 'NODE_ENV') add(rel, i + 1, `client component reads server-only env ${m[1]}`);
      }
      if (/from ['"](?:server-only|@\/lib\/supabase\/admin|@\/lib\/server\/)/.test(line)) add(rel, i + 1, 'client component imports a server-only module');
    });
  }
}

// 5. Server-only modules that hold secrets must be guarded.
for (const rel of ['src/lib/supabase/admin.ts', 'src/lib/supabase/server.ts', 'src/lib/auth.ts']) {
  try {
    if (!/import ['"]server-only['"]/.test(readFileSync(join(ROOT, rel), 'utf8'))) add(rel, 1, 'missing import "server-only"');
  } catch {
    add(rel, 1, 'expected file is missing');
  }
}

if (findings.length) {
  console.error(`check-secrets: ${findings.length} problem(s)\n` + findings.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
console.log(`check-secrets: OK (${files.length} files scanned, no secrets, no real .env files, client code reads only NEXT_PUBLIC_ variables)`);
