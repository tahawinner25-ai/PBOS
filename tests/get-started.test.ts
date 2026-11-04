import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChecklist, type ChecklistInput } from '../src/lib/get-started';

const empty: ChecklistInput = { hasName: false, hasNiche: false, ideas: 0, deals: 0, posts: 0, loopRan: false, aiReady: false, connected: { youtube: false, instagram: false, gmail: false } };

test('an empty account has nothing done and points at the profile first', () => {
  const r = buildChecklist(empty);
  assert.equal(r.done, 0);
  assert.equal(r.total, r.items.length);
  assert.equal(r.next?.key, 'profile');
});

test('items are derived from real records and the next step skips finished ones', () => {
  const r = buildChecklist({ ...empty, hasName: true, hasNiche: true, ideas: 2, aiReady: true });
  assert.equal(r.done, 3);
  assert.equal(r.next?.key, 'loop');
});

test('profile needs both name and niche', () => {
  assert.equal(buildChecklist({ ...empty, hasName: true }).items[0].done, false);
});

test('everything done leaves no next step', () => {
  const r = buildChecklist({ hasName: true, hasNiche: true, ideas: 1, deals: 1, posts: 1, loopRan: true, aiReady: true, connected: { youtube: true, instagram: true, gmail: true } });
  assert.equal(r.done, r.total);
  assert.equal(r.next, null);
});
