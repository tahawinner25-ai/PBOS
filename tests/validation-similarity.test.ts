import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNearDuplicate, jaccard } from '../src/lib/similarity';
import { parse, parsePipeLines, rules } from '../src/lib/validation';
import { missingProfileFields, goalSummary } from '../src/lib/profile';
import { makeProfile } from './fixtures';

describe('similarity', () => {
  it('scores identical text as 1 and unrelated text near 0', () => {
    assert.equal(jaccard('Pay yourself a salary', 'pay yourself a SALARY!'), 1);
    assert.ok(jaccard('Pay yourself a salary', 'Three camera angles for cooking videos') < 0.1);
  });

  it('detects lazy cross-platform copies but allows genuinely different angles', () => {
    assert.equal(isNearDuplicate('Why freelancers should pay themselves a salary', 'Why freelancers should pay themselves a salary today'), true);
    assert.equal(isNearDuplicate('Why freelancers should pay themselves a salary', 'The invoice habit that finally ended my cash-flow panic'), false);
  });
});

describe('form validation', () => {
  it('parses a valid form and returns typed values', () => {
    const fd = new FormData();
    fd.set('hook', '  A hook that is long enough  ');
    fd.set('platform', 'Instagram');
    fd.set('scheduled_for', '2026-10-20');
    fd.set('value', '1,250.50');
    const res = parse(fd, {
      hook: rules.text({ min: 5, max: 200 }),
      platform: rules.oneOf(['Instagram', 'TikTok'] as const),
      scheduled_for: rules.optionalDate(),
      value: rules.number({ min: 0 }),
      note: rules.optionalText({ max: 10 }),
    });
    assert.ok(res.ok);
    assert.deepEqual(res.ok && res.data, { hook: 'A hook that is long enough', platform: 'Instagram', scheduled_for: '2026-10-20', value: 1250.5, note: null });
  });

  it('returns per-field errors with readable messages', () => {
    const res = parse(
      { hook: 'hi', platform: 'MySpace', scheduled_for: '2026-02-31', value: 'abc', email: 'nope' },
      {
        hook: rules.text({ min: 5 }),
        platform: rules.oneOf(['Instagram'] as const),
        scheduled_for: rules.optionalDate(),
        value: rules.number(),
        email: rules.email(),
      },
      { hook: 'Hook' },
    );
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.match(res.errors.hook, /Hook needs at least 5 characters/);
      assert.match(res.errors.platform, /must be one of/);
      assert.match(res.errors.scheduled_for, /valid date/);
      assert.match(res.errors.value, /must be a number/);
      assert.match(res.errors.email, /valid email/);
    }
  });

  it('rejects files or objects where text is expected', () => {
    assert.equal(rules.text()({ a: 1 }, 'Field').ok, false);
    assert.equal(rules.optionalText()('', 'Field').ok, true);
  });

  it('parses pipe-separated lines used by the settings form', () => {
    assert.deepEqual(parsePipeLines('Sponsored video | One short video\n\n Story set | Three frames | extra | more', 2), [
      ['Sponsored video', 'One short video'],
      ['Story set', 'Three frames | extra | more'],
    ]);
  });
});

describe('profile completeness', () => {
  it('lists missing fields in priority order with a targeted question each', () => {
    const missing = missingProfileFields(makeProfile({ positioning: null, services: [], voice: '' }));
    assert.deepEqual(missing.map((m) => m.field), ['positioning', 'services', 'voice']);
    assert.ok(missing.every((m) => m.question.endsWith('?')));
  });

  it('summarises the stated goal and returns null when none is set', () => {
    assert.equal(goalSummary(makeProfile()), 'Land two brand partnerships this quarter');
    assert.equal(goalSummary(makeProfile({ goals: {} })), null);
  });
});
