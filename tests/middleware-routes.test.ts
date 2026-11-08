import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

// A signed-in page that Clerk's middleware does not match crashes on its first auth() call ("Something went wrong").
// This happened once with /video, so every page folder under (app) must be both matched and treated as private.
const source = readFileSync('src/middleware.ts', 'utf8');
const folders = readdirSync('src/app/(app)', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const matcherGroup = /matcher: \[\s*'\/\(([^)]*)\)\(\.\*\)'/.exec(source)?.[1].split('|') ?? [];

test('the (app) folders are found', () => assert.ok(folders.length >= 10, folders.join(',')));

for (const folder of folders) {
  test(`/${folder} runs through Clerk's middleware and is private`, () => {
    assert.ok(matcherGroup.includes(folder), `config.matcher is missing "${folder}"`);
    assert.ok(source.includes(`'/${folder}(.*)'`), `isPrivatePage is missing "${folder}"`);
  });
}
