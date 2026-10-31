import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDemoView, demoAgentData, SAMPLE_CREATOR } from '../src/lib/demo-workspace';

const NOW = new Date('2026-10-23T12:00:00Z');

test('sample data is clearly fake and entirely in memory', () => {
  const d = demoAgentData(NOW);
  assert.ok(d.ideas.length >= 5 && d.deals.length >= 5 && d.posts.length >= 5 && d.revenue.length >= 3);
  for (const row of [...d.ideas, ...d.deals, ...d.posts, ...d.revenue]) {
    assert.equal(row.creator_id, SAMPLE_CREATOR);
    assert.equal(row.is_demo, true);
  }
  for (const deal of d.deals) assert.match(deal.brand ?? '', /\(Demo\)/);
  assert.match(d.profile.name ?? '', /sample/i);
  assert.ok(!JSON.stringify(d).includes('@') || JSON.stringify(d).match(/@[a-z-]+-demo\.example/), 'only .example addresses');
});

test('ids are stable across calls so React keys and links do not churn', () => {
  assert.deepEqual(demoAgentData(NOW).ideas.map((i) => i.id), demoAgentData(NOW).ideas.map((i) => i.id));
});

test('the real rules engine finds the planted problems', () => {
  const v = buildDemoView(NOW);
  const keys = v.plan.flags.map((f) => f.key);
  for (const k of ['ideas_stale', 'posts_unmeasured', 'deals_stale', 'invoices_overdue', 'schedule_slipped']) assert.ok(keys.includes(k), `${k} in ${keys.join(',')}`);
  assert.ok(!keys.some((k) => ['publish_failed', 'connection_reauth', 'sync_stale'].includes(k)), 'no platform findings without an ops snapshot');
  assert.ok(v.plan.top.length >= 1 && v.plan.top.length <= 3);
  assert.equal(v.plan.top[0].key, 'invoices_overdue');
});

test('every finding cites sample records that exist', () => {
  const v = buildDemoView(NOW);
  const ids = new Set([...v.data.ideas, ...v.data.deals, ...v.data.posts, ...v.data.revenue].map((r) => r.id));
  for (const f of v.plan.flags) for (const id of f.source_record_ids) assert.ok(ids.has(id) || id.startsWith('profile:'), `${f.key}: ${id}`);
});

test('the draft is a template built from sample records, with no invented numbers or promises', () => {
  const v = buildDemoView(NOW);
  assert.ok(v.draft);
  assert.match(v.draft.subject ?? '', /Orbit Coffee \(Demo\)/);
  assert.match(v.draft.body, /\$2,000/);
  assert.doesNotMatch(v.draft.body, /guarantee|legal|late fee/i);
});

test('analytics are computed from sample posts only', () => {
  const v = buildDemoView(NOW);
  assert.equal(v.analytics.totalPosts, v.data.posts.length);
  assert.ok(v.analytics.unmeasured.length >= 2);
});
