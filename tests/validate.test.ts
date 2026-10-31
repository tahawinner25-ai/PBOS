import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectNumbers, numbersIn, scanText } from '../src/lib/agent/validate';

describe('numbersIn / collectNumbers', () => {
  it('extracts numbers, thousands separators and decimals', () => {
    assert.deepEqual(numbersIn('3 posts, $4,500 and 4.2% on 2026-10-14'), [3, 4500, 4.2, 2026, 10, 14]);
  });

  it('ignores digits that belong to UUIDs', () => {
    assert.deepEqual(numbersIn('see 8f3a2c10-1b2c-4d3e-9f40-0a1b2c3d4e5f for 7 days'), [7]);
  });

  it('collects numbers from values but skips id fields', () => {
    const set = collectNumbers({
      id: '12345678-1234-4234-8234-123456789012',
      source_record_ids: ['99999999-9999-4999-8999-999999999999'],
      brand_id: 77,
      amount: 1500,
      text: 'due in 9 days',
      nested: [{ views: 1200 }],
    });
    assert.deepEqual(Array.from(set).sort((a, b) => a - b), [9, 1200, 1500]);
  });
});

describe('scanText', () => {
  const allowed = new Set([3, 7, 1500]);

  it('accepts supported numbers and rejects invented ones', () => {
    assert.deepEqual(scanText('3 posts, 7 days, $1,500', allowed), []);
    assert.deepEqual(scanText('That is 40 posts', allowed), ['text contains unsupported number 40']);
  });

  it('rejects income, growth and outcome promises', () => {
    for (const bad of [
      'This will guarantee a deal.',
      'You will earn more with this.',
      'This post will go viral.',
      'A 10x growth plan',
      'Build passive income fast',
    ]) {
      assert.ok(scanText(bad, allowed).length > 0, bad);
    }
  });

  it('rejects binding legal language and legal threats', () => {
    for (const bad of [
      'Payment is hereby due.',
      'This is a legally binding agreement.',
      'We will take legal action.',
      'Contact my attorney.',
      'We will send this to a collections agency.',
    ]) {
      assert.ok(scanText(bad, allowed).length > 0, bad);
    }
  });

  it('allows ordinary professional language', () => {
    assert.deepEqual(scanText('Could you confirm when to expect payment? Thanks for your courtesy.', allowed), []);
  });
});
