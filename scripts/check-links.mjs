#!/usr/bin/env node
// Verifies that every internal link and redirect written as a string literal points at a real route,
// and that same-page anchors have a matching id. External links are not fetched.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const APP = join(ROOT, 'src/app');
const SRC = join(ROOT, 'src');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

// ── routes from the app directory ────────────────────────────────────────
const routes = []; // { segments: string[] }
const META = { 'robots.ts': '/robots.txt', 'sitemap.ts': '/sitemap.xml', 'opengraph-image.tsx': '/opengraph-image', 'icon.svg': '/icon.svg' };
for (const file of walk(APP)) {
  const rel = relative(APP, file).split(sep).join('/');
  const name = rel.split('/').pop();
  const dir = rel.split('/').slice(0, -1).filter((s) => !/^\(.+\)$/.test(s));
  if (name === 'page.tsx' || name === 'route.ts') routes.push(dir);
  else if (rel === name && META[name]) routes.push(META[name].split('/').filter(Boolean));
}
// Files under public/ are served at their path (nested ones too, e.g. /showreel/showreel.mp4).
// public/ may not exist in a fresh clone (git does not keep empty folders).
const PUBLIC = join(ROOT, 'public');
if (existsSync(PUBLIC)) for (const f of walk(PUBLIC)) routes.push(relative(PUBLIC, f).split(sep).filter(Boolean));

function matches(route, parts) {
  for (let i = 0; i < route.length; i += 1) {
    const seg = route[i];
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return true; // optional catch-all
    if (/^\[\.\.\..+\]$/.test(seg)) return parts.length > i;
    if (i >= parts.length) return false;
    if (!/^\[.+\]$/.test(seg) && seg !== parts[i]) return false;
  }
  return route.length === parts.length;
}
const routeExists = (pathname) => routes.some((r) => matches(r, pathname.split('/').filter(Boolean)));

// ── ids available for anchors ────────────────────────────────────────────
const ids = new Set();
const sources = [...walk(SRC)].filter((f) => /\.tsx?$/.test(f));
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bid=["']([^"'{}$]+)["']/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\bid:\s*['"]([a-z0-9-]+)['"]/g)) ids.add(m[1]);
  for (const m of text.matchAll(/\bid=\{`([a-z0-9-]+)-\$\{/g)) ids.add(`${m[1]}-*`);
}

// ── links in source ──────────────────────────────────────────────────────
const problems = [];
let checked = 0;
for (const file of sources) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const found = [
      ...[...line.matchAll(/\bhref=["'](\/[^"'{}$]*)["']/g)].map((m) => m[1]),
      ...[...line.matchAll(/\bhref=\{["'](\/[^"'$]*)["']\}/g)].map((m) => m[1]),
      ...[...line.matchAll(/\b(?:redirect|router\.push|router\.replace)\(\s*['"](\/[^'"$]*)['"]/g)].map((m) => m[1]),
    ];
    for (const target of found) {
      if (target.startsWith('//')) continue;
      checked += 1;
      const [pathAndQuery, hash] = target.split('#');
      const pathname = pathAndQuery.split('?')[0] || '/';
      if (!routeExists(pathname)) problems.push(`${rel}:${i + 1}  ${target}  (no such route)`);
      else if (hash && pathname === '/' && ![...ids].some((id) => id === hash || (id.endsWith('*') && hash.startsWith(id.slice(0, -1))))) problems.push(`${rel}:${i + 1}  ${target}  (no element with id "${hash}")`);
    }
  });
}

if (problems.length) {
  console.error(`check-links: ${problems.length} broken link(s)\n` + problems.map((p) => `  - ${p}`).join('\n'));
  process.exit(1);
}
console.log(`check-links: OK (${checked} internal links and redirects checked against ${routes.length} routes)`);
