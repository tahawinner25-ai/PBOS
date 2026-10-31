import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeFeedback } from '../src/lib/agent/learn';
import { NOW, daysAgo, makeEvent } from './fixtures';

const ev = (type: 'accepted' | 'ignored', key: string, ago: number, pillar = 'Analytics') =>
  makeEvent({ type, pillar, payload: { key, action: `Do ${key}` }, created_at: daysAgo(ago) });

describe('feedback learning', () => {
  it('has no effect without feedback', () => {
    const f = analyzeFeedback([], NOW);
    assert.equal(f.suppressed.size, 0);
    assert.deepEqual(f.notes, []);
  });

  it('pauses a suggestion ignored twice within 14 days and says when it resumes', () => {
    const f = analyzeFeedback([ev('ignored', 'k', 5), ev('ignored', 'k', 2)], NOW);
    const s = f.suppressed.get('k');
    assert.equal(s?.reason, 'ignored');
    assert.equal(s?.resumes, daysAgo(5).slice(0, 10).replace(/.*/, (d) => new Date(new Date(`${d}T00:00:00Z`).getTime() + 14 * 86_400_000).toISOString().slice(0, 10)));
  });

  it('does not pause on a single ignore or on ignores older than 14 days', () => {
    assert.equal(analyzeFeedback([ev('ignored', 'k', 2)], NOW).suppressed.size, 0);
    assert.equal(analyzeFeedback([ev('ignored', 'k', 30), ev('ignored', 'k', 20)], NOW).suppressed.size, 0);
  });

  it('gives an accepted suggestion a short grace period, then lets it return', () => {
    assert.equal(analyzeFeedback([ev('accepted', 'k', 1)], NOW).suppressed.get('k')?.reason, 'accepted_recently');
    assert.equal(analyzeFeedback([ev('accepted', 'k', 3)], NOW).suppressed.size, 0);
  });

  it('resets ignore counting after an acceptance', () => {
    const f = analyzeFeedback([ev('ignored', 'k', 9), ev('ignored', 'k', 8), ev('accepted', 'k', 6), ev('ignored', 'k', 4)], NOW);
    assert.equal(f.suppressed.size, 0);
  });

  it('ranks accepted pillars up and ignored pillars down, within caps', () => {
    const accepts = Array.from({ length: 6 }, (_, i) => ev('accepted', `a${i}`, 10, 'Deals'));
    const ignores = Array.from({ length: 6 }, (_, i) => ev('ignored', `i${i}`, 10, 'Ideation'));
    const f = analyzeFeedback([...accepts, ...ignores], NOW);
    assert.equal(f.pillarAdjust.Deals, 15);
    assert.equal(f.pillarAdjust.Ideation, -9);
    assert.equal(f.pillarAdjust.Revenue, 0);
  });

  it('ignores events without a key', () => {
    const f = analyzeFeedback([makeEvent({ type: 'ignored', payload: {} })], NOW);
    assert.equal(f.suppressed.size, 0);
  });
});
