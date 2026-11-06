import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * publish_jobs and social_connections grant the signed-in role only SOME columns (tokens, upload URLs and locks stay
 * server-side). `select('*')` through the user's client is refused with 42501 "permission denied for table", which the
 * creator sees as "Could not save to the database". Only the service-role client (`db.`/`admin`) may read every column.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test("no user-client select('*') on column-restricted tables", () => {
  const bad: string[] = [];
  for (const f of files(new URL('../src', import.meta.url).pathname)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/(\w+(?:\.\w+)?)\.from\('(publish_jobs|social_connections)'\)\s*\.select\('\*'\)/g)) {
      if (!/^(db|this\.db|admin|setup\.db)$/.test(m[1])) bad.push(`${f}: ${m[0]}`);
    }
  }
  assert.deepEqual(bad, []);
});
