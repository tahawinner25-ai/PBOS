import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSystemStatus } from '../src/lib/system-status';

const none = { aiKey: false, aiProvider: null, openaiImageKey: false, storageReady: false, cronSecret: false, siteUrl: false } as const;

test('everything missing: each row says what to add, and images still work on the free service', () => {
  const rows = buildSystemStatus(none);
  assert.equal(rows.find((r) => r.key === 'ai')?.ok, false);
  assert.match(rows.find((r) => r.key === 'ai')!.detail, /AI_API_KEY/);
  assert.equal(rows.find((r) => r.key === 'storage')?.ok, false);
  assert.equal(rows.find((r) => r.key === 'images')?.ok, true);
});

test('provider wording follows what is configured and no row prints a value', () => {
  const rows = buildSystemStatus({ aiKey: true, aiProvider: 'anthropic', openaiImageKey: true, storageReady: true, cronSecret: true, siteUrl: true });
  assert.ok(rows.every((r) => r.ok));
  assert.match(rows[0].detail, /Anthropic/);
  assert.match(rows[1].detail, /OpenAI/);
});
