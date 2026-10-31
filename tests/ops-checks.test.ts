import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runChecks } from '../src/lib/agent/checks';
import { buildDailyPlan } from '../src/lib/agent/daily';
import { resolveSource, minimalRecord } from '../src/lib/agent/sources';
import type { AgentData, OpsConnection, OpsData, OpsJob } from '../src/lib/agent/types';
import type { CreatorProfile } from '../src/lib/types';

const NOW = new Date('2026-10-22T12:00:00Z');
const ago = (d: number, h = 0) => new Date(NOW.getTime() - d * 86_400_000 - h * 3_600_000).toISOString();
const profile = { id: 'p1', user_id: 'u', name: 'Sam', niche: 'editing', positioning: 'x', voice: 'plain', goals: { primary: 'grow' }, audience_notes: 'editors', services: [{ name: 'a', description: 'b' }], rate_card: [{ item: 'x', price: 1 }], faq: [], ai_persona: null, media_kit_published: false, avatar_path: null, created_at: '', updated_at: '' } as unknown as CreatorProfile;
const conn = (o: Partial<OpsConnection> = {}): OpsConnection => ({ id: 'c-yt', platform: 'youtube', status: 'active', last_synced_at: ago(0, 1), access_token_expires_at: null, display_name: 'My channel', ...o });
const job = (o: Partial<OpsJob> = {}): OpsJob => ({ id: 'j1', platform: 'instagram', format: 'reel', title: 'Launch reel', status: 'draft', scheduled_for: null, created_at: ago(0, 1), updated_at: ago(0, 1), ...o });
const data = (ops?: Partial<OpsData>, extra: Partial<AgentData> = {}): AgentData => ({ profile, ideas: [], posts: [], deals: [], revenue: [], events: [], ops: ops ? { connections: [], jobs: [], cronConfigured: true, ...ops } : undefined, ...extra });
const keys = (d: AgentData) => runChecks(d, NOW).flags.map((f) => f.key);

test('without ops data nothing new is flagged (existing behaviour unchanged)', () => assert.deepEqual(keys(data()), []));
test('a healthy setup raises nothing', () => assert.deepEqual(keys(data({ connections: [conn()], jobs: [job({ status: 'published' })] })), []));

test('needs_review is the top priority and cites the job', () => {
  const r = runChecks(data({ connections: [conn()], jobs: [job({ status: 'needs_review' })] }), NOW);
  assert.equal(r.candidates[0].key, 'publish_needs_review');
  assert.deepEqual(r.candidates[0].source_record_ids, ['j1']);
  assert.match(r.candidates[0].reason, /will not post it again/);
});

test('a broken connection is flagged with its id', () => {
  const r = runChecks(data({ connections: [conn({ status: 'needs_reauth' })] }), NOW);
  assert.equal(r.flags[0].key, 'connection_reauth');
  assert.deepEqual(r.flags[0].source_record_ids, ['c-yt']);
});

test('failed posts count only within 14 days', () => {
  assert.ok(keys(data({ connections: [conn()], jobs: [job({ status: 'failed', updated_at: ago(3) })] })).includes('publish_failed'));
  assert.ok(!keys(data({ connections: [conn()], jobs: [job({ status: 'failed', updated_at: ago(20) })] })).includes('publish_failed'));
});

test('overdue scheduled Instagram posts raise schedule_not_running; the wording depends on whether cron is configured', () => {
  const late = job({ status: 'scheduled', scheduled_for: ago(0, 2) });
  const withCron = runChecks(data({ connections: [conn({ id: 'c-ig', platform: 'instagram' })], jobs: [late], cronConfigured: true }), NOW).candidates.find((c) => c.key === 'schedule_not_running');
  const noCron = runChecks(data({ connections: [conn({ id: 'c-ig', platform: 'instagram' })], jobs: [late], cronConfigured: false }), NOW).candidates.find((c) => c.key === 'schedule_not_running');
  assert.ok(withCron && noCron);
  assert.match(noCron.action, /CRON_SECRET/);
  assert.doesNotMatch(withCron.action, /CRON_SECRET/);
  // Not yet due: nothing.
  assert.ok(!keys(data({ connections: [conn({ id: 'c-ig', platform: 'instagram' })], jobs: [job({ status: 'scheduled', scheduled_for: new Date(NOW.getTime() + 3_600_000).toISOString() })] })).includes('schedule_not_running'));
  // A scheduled YouTube job is published by YouTube itself, never flagged here.
  assert.ok(!keys(data({ connections: [conn()], jobs: [job({ platform: 'youtube', status: 'scheduled', scheduled_for: ago(0, 2) })] })).includes('schedule_not_running'));
});

test('an Instagram token about to expire is flagged; a far-off or unknown expiry is not', () => {
  const soon = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
  assert.ok(keys(data({ connections: [conn({ platform: 'instagram', access_token_expires_at: soon })] })).includes('token_expiring'));
  assert.ok(!keys(data({ connections: [conn({ platform: 'instagram', access_token_expires_at: new Date(NOW.getTime() + 40 * 86_400_000).toISOString() })] })).includes('token_expiring'));
  assert.ok(!keys(data({ connections: [conn({ platform: 'instagram', access_token_expires_at: null })] })).includes('token_expiring'));
});

test('stale or missing sync is flagged, and a broken connection is not also called stale', () => {
  assert.ok(keys(data({ connections: [conn({ last_synced_at: ago(5) })] })).includes('sync_stale'));
  assert.ok(keys(data({ connections: [conn({ last_synced_at: null })] })).includes('sync_stale'));
  assert.ok(!keys(data({ connections: [conn({ status: 'needs_reauth', last_synced_at: ago(9) })] })).includes('sync_stale'));
});

test('drafts waiting more than 2 days; fresh drafts are left alone', () => {
  assert.ok(keys(data({ connections: [conn()], jobs: [job({ created_at: ago(3) })] })).includes('drafts_waiting'));
  assert.ok(!keys(data({ connections: [conn()], jobs: [job({ created_at: ago(0, 5) })] })).includes('drafts_waiting'));
});

test('no_connection needs hand-tracked YouTube or Instagram posts, and cites them', () => {
  const post = { id: 'post1', creator_id: 'p1', idea_id: null, platform: 'YouTube', format: null, published_at: ago(2), views: 10, likes: 1, comments: 0, shares: 0, saves: 0, clicks: null, notes: null, is_demo: false, created_at: ago(2), updated_at: ago(2), source: 'manual' as const };
  const r = runChecks(data({}, { posts: [post] }), NOW);
  assert.deepEqual(r.flags.find((f) => f.key === 'no_connection')?.source_record_ids, ['post1']);
  assert.ok(!keys(data({}, { posts: [{ ...post, platform: 'TikTok' }] })).includes('no_connection'));
  assert.ok(!keys(data({ connections: [conn()] }, { posts: [post] })).includes('no_connection'));
});

test('every ops finding cites at least one record that resolves, and the agent never sees secrets', () => {
  const d = data({ connections: [conn({ status: 'needs_reauth' })], jobs: [job({ status: 'failed', updated_at: ago(1) }), job({ id: 'j2', status: 'needs_review' })] });
  for (const f of runChecks(d, NOW).flags) {
    assert.ok(f.source_record_ids.length > 0, f.key);
    for (const id of f.source_record_ids) {
      assert.notEqual(resolveSource(id, d).kind, 'unknown', `${f.key}:${id}`);
      const rec = JSON.stringify(minimalRecord(id, d, NOW));
      assert.doesNotMatch(rec, /token|secret|caption|storage_path/i);
    }
  }
});

test('ops findings flow through the daily plan and respect ignore-suppression', () => {
  const d = data({ connections: [conn({ status: 'needs_reauth' })] });
  const plan = buildDailyPlan(d, NOW);
  assert.equal(plan.top[0].key, 'connection_reauth');
  const ignored = (n: number) => ({ id: `e${n}`, creator_id: 'p1', type: 'ignored' as const, pillar: 'Posting', payload: { key: 'connection_reauth', action: 'Reconnect YouTube' }, source_record_ids: ['c-yt'], created_at: ago(n) });
  const after = buildDailyPlan({ ...d, events: [ignored(1), ignored(2)] as never }, NOW);
  assert.ok(!after.top.some((c) => c.key === 'connection_reauth'), 'ignored twice: paused');
  assert.ok(after.flags.some((f) => f.key === 'connection_reauth'), 'but the flag is still shown');
});
