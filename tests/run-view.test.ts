import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDailyPlan } from '../src/lib/agent/daily';
import { composeDashboard, latestRun } from '../src/lib/agent/run-view';
import type { AgentEvent } from '../src/lib/types';
import { NOW, daysAgo, dateOnly, makeData, makeDeal, makeEvent, makeInvoice, makePost, uid } from './fixtures';

const run = (runId: string, at: number, extra: Partial<AgentEvent>[] = []): AgentEvent[] => {
  const flag = makeEvent({ type: 'flag', pillar: 'Analytics', payload: { run_id: runId, key: 'posts_unmeasured', message: 'LLM flag', source: 'llm' }, created_at: daysAgo(at) });
  const sug = makeEvent({
    type: 'suggestion',
    pillar: 'Analytics',
    payload: { run_id: runId, key: 'posts_unmeasured', action: 'Log performance', reason: 'Blocked', href: '/analytics', source: 'llm' },
    source_record_ids: [uid()],
    created_at: daysAgo(at),
  });
  return [flag, sug, ...extra.map((e) => makeEvent({ type: 'flag', ...e }))];
};

describe('latestRun', () => {
  it('returns null without run events', () => {
    assert.equal(latestRun([]), null);
    assert.equal(latestRun([makeEvent({ type: 'accepted', payload: { key: 'k' } })]), null);
  });

  it('picks the newest run and attaches the latest decision to each suggestion', () => {
    const older = run('old', 5);
    const newer = run('new', 1);
    const sug = newer.find((e) => e.type === 'suggestion')!;
    const ignored = makeEvent({ type: 'ignored', payload: { suggestion_event_id: sug.id, key: 'posts_unmeasured' }, created_at: daysAgo(0.5) });
    const result = latestRun([ignored, ...newer, ...older]);
    assert.equal(result?.run_id, 'new');
    assert.equal(result?.suggestions.length, 1);
    assert.equal(result?.suggestions[0].decision, 'ignored');
    assert.equal(result?.source, 'llm');
  });
});

describe('composeDashboard', () => {
  const posts = [makePost(), makePost()];

  it('shows live flags and hides stored suggestions that are no longer true', () => {
    const stored = latestRun([...run('r', 1)]);
    const stillTrue = buildDailyPlan(makeData({ posts }), NOW);
    const view = composeDashboard(stored, stillTrue, NOW);
    assert.equal(view.suggestions.length, 1);
    assert.equal(view.flags.find((f) => f.key === 'posts_unmeasured')?.message, 'LLM flag');
    assert.equal(view.resolved, 0);

    const fixed = buildDailyPlan(makeData({ posts: [makePost({ views: 10 })] }), NOW);
    const after = composeDashboard(stored, fixed, NOW);
    assert.equal(after.suggestions.length, 0);
    assert.equal(after.resolved, 1);
    assert.equal(after.flags.length, 0);
  });

  it('surfaces new findings the stored run does not cover and marks old runs stale', () => {
    const stored = latestRun(run('r', 2));
    const data = makeData({ posts, revenue: [makeInvoice({ status: 'overdue', due_date: dateOnly(3) })], deals: [makeDeal()] });
    const view = composeDashboard(stored, buildDailyPlan(data, NOW), NOW);
    assert.deepEqual(view.newFindings.map((c) => c.key), ['invoices_overdue']);
    assert.equal(view.stale, true);
    assert.equal(composeDashboard(null, buildDailyPlan(data, NOW), NOW).stale, true);
  });

  it('is not stale for a run from the last day', () => {
    const stored = latestRun(run('r', 0.2));
    assert.equal(composeDashboard(stored, buildDailyPlan(makeData({ posts }), NOW), NOW).stale, false);
  });
});
