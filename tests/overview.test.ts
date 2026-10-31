import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOverview } from '../src/lib/agent/overview';
import type { AgentData } from '../src/lib/agent/types';
import type { CreatorProfile } from '../src/lib/types';

const NOW = new Date('2026-10-22T12:00:00Z');
const profile = { id: 'p1', user_id: 'u', name: 'Sam', niche: 'editing', positioning: 'x', voice: 'plain', goals: { primary: 'grow' }, audience_notes: 'editors', services: [], rate_card: [], faq: [], ai_persona: null, media_kit_published: false, avatar_path: null, created_at: '', updated_at: '' } as unknown as CreatorProfile;
const data: AgentData = {
  profile, ideas: [{ id: 'idea-1', creator_id: 'p1', platform: 'YouTube', format: 'Long video', hook: 'Editing in one hour', hook_variants: [], script: null, status: 'idea', content_mix: null, scheduled_for: null, adapted_from: null, is_demo: false, created_at: '2026-09-01T00:00:00Z', updated_at: '' } as never],
  posts: [], deals: [], revenue: [], events: [],
  ops: { connections: [{ id: 'c1', platform: 'youtube', status: 'needs_reauth', last_synced_at: null, access_token_expires_at: null, display_name: 'Chan' }], jobs: [{ id: 'j1', platform: 'instagram', format: 'reel', title: 'Launch', status: 'failed', scheduled_for: null, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z' }], cronConfigured: true },
};

test('overview is bounded, cites real ids, and has no secret-looking fields', () => {
  const { context, ids } = buildOverview(data, NOW);
  assert.ok(ids.has('j1') && ids.has('c1') && ids.has('idea-1'));
  assert.doesNotMatch(JSON.stringify(context), /token|secret|caption|storage_path|email/i);
});

test('overview counts what exists and nothing else', () => {
  const { context } = buildOverview(data, NOW);
  const counts = context.counts as Record<string, unknown>;
  assert.deepEqual(counts.ideas_by_status, { idea: 1 });
  assert.equal(counts.posts_total, 0);
  assert.deepEqual(counts.publish_jobs_by_status, { failed: 1 });
});
