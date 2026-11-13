import assert from 'node:assert/strict';
import { test } from 'node:test';
import { globalDailyLimit, resetBudgetCache, sumUnits, underGlobalLimit } from '../src/lib/budget';
import { formFingerprint, isDuplicateSubmit } from '../src/lib/dedupe';

function fakeAdmin(rows: Array<{ units: unknown }>, error: { code: string } | null = null) {
  const calls = { n: 0 };
  const chain: Record<string, unknown> = {};
  chain.select = () => chain; chain.eq = () => chain; chain.in = () => chain;
  chain.limit = async () => { calls.n += 1; return { data: error ? null : rows, error }; };
  return { admin: { from: () => chain } as never, calls };
}

test('the shared daily limit defaults to 3000, can be turned off with 0, and ignores nonsense', () => {
  assert.equal(globalDailyLimit({}), 3000);
  assert.equal(globalDailyLimit({ PBOS_GLOBAL_DAILY_LIMIT: '500' }), 500);
  assert.equal(globalDailyLimit({ PBOS_GLOBAL_DAILY_LIMIT: '0' }), 0);
  assert.equal(globalDailyLimit({ PBOS_GLOBAL_DAILY_LIMIT: 'lots' }), 3000);
  assert.equal(globalDailyLimit({ PBOS_GLOBAL_DAILY_LIMIT: '-5' }), 3000);
});

test('sumUnits adds only positive numbers', () => {
  assert.equal(sumUnits([{ units: 3 }, { units: '4' }, { units: -2 }, { units: 'x' }, {}]), 7);
  assert.equal(sumUnits(null), 0);
});

test('the shared cap blocks once the total reaches the limit, and the total is cached for a minute', async () => {
  resetBudgetCache();
  const now = new Date('2026-11-11T10:00:00Z');
  const { admin, calls } = fakeAdmin([{ units: 60 }, { units: 40 }]);
  assert.equal(await underGlobalLimit(admin, now, 101), true);
  assert.equal(await underGlobalLimit(admin, new Date(now.getTime() + 30_000), 100), false, 'cached total 100 is not under 100');
  assert.equal(calls.n, 1);
  assert.equal(await underGlobalLimit(admin, new Date(now.getTime() + 90_000), 101), true);
  assert.equal(calls.n, 2);
  assert.equal(await underGlobalLimit(admin, now, 0), true, '0 means off');
});

test('if the shared total cannot be read the cap fails open (per-creator limits still apply)', async () => {
  resetBudgetCache();
  const { admin } = fakeAdmin([], { code: 'XX000' });
  assert.equal(await underGlobalLimit(admin, new Date('2026-11-12T10:00:00Z'), 10), true);
});

test('double submits within a few seconds are caught; different content or later is not', () => {
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
  const a = formFingerprint(fd({ brand: 'Acme', value: '10' }));
  assert.equal(a, formFingerprint(fd({ value: '10', brand: 'Acme' })), 'field order does not matter');
  assert.equal(isDuplicateSubmit(`u1:${a}`, 4000, 1000), false);
  assert.equal(isDuplicateSubmit(`u1:${a}`, 4000, 2000), true);
  assert.equal(isDuplicateSubmit(`u2:${a}`, 4000, 2000), false, 'another person');
  assert.equal(isDuplicateSubmit(`u1:${formFingerprint(fd({ brand: 'Other' }))}`, 4000, 2000), false);
  assert.equal(isDuplicateSubmit(`u1:${a}`, 4000, 6000), false, 'after the window');
});
