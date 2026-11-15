import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURE_IDS, FEATURES, LIMITS, judge, limitFor, windowResetAt, windowStartDay } from '../src/lib/plans';

test('week starts on Monday (UTC) and month on the 1st', () => {
  assert.equal(windowStartDay('week', new Date('2026-11-15T21:00:00Z')), '2026-11-09'); // Sunday -> Monday before
  assert.equal(windowStartDay('week', new Date('2026-11-09T00:00:00Z')), '2026-11-09');
  assert.equal(windowStartDay('week', new Date('2026-11-11T12:00:00Z')), '2026-11-09');
  assert.equal(windowStartDay('month', new Date('2026-11-15T21:00:00Z')), '2026-11-01');
});

test('reset moments are the start of the next week or month', () => {
  assert.equal(windowResetAt('week', new Date('2026-11-15T21:00:00Z')).toISOString(), '2026-11-16T00:00:00.000Z');
  assert.equal(windowResetAt('month', new Date('2026-12-20T00:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
});

test('every plan defines every feature, and higher plans never get less', () => {
  for (const f of FEATURE_IDS) {
    const free = limitFor('free', f), pro = limitFor('pro', f), max = limitFor('max', f);
    assert.ok(free !== null && free > 0, `${f} free`);
    assert.ok(pro !== null && pro > free, `${f} pro > free`);
    assert.equal(max, null, `${f} max is unlimited`);
    assert.ok(FEATURES[f].provider && FEATURES[f].bucket);
  }
  assert.equal(LIMITS.free.image, 3);
});

test('judge allows below the limit and refuses at it with a plain message', () => {
  const now = new Date('2026-11-12T10:00:00Z');
  assert.equal(judge('free', 'image', 2, now).allowed, true);
  const v = judge('free', 'image', 3, now);
  assert.equal(v.allowed, false);
  if (!v.allowed) { assert.match(v.message, /all 3 images on the Free plan this week/); assert.match(v.message, /Monday 16 November|Monday, 16 November|16 November/); assert.match(v.message, /Pro/); }
  assert.equal(judge('max', 'agent_run', 1_000_000, now).allowed, true);
  const p = judge('pro', 'agent_run', 150, now);
  assert.equal(p.allowed, false);
  if (!p.allowed) assert.match(p.message, /Max/);
});
