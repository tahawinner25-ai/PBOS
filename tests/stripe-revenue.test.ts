import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chargeIsGone, chargeToRow, minorToMajor, parseRestrictedKey } from '../src/lib/stripe-revenue';

const CH = { id: 'ch_3Abc123DEF456', amount: 2500, amount_refunded: 0, currency: 'usd', created: 1794000000, paid: true, status: 'succeeded', description: 'Brand deal  deposit' };

test('only a restricted key is accepted; full secret and publishable keys are refused with a reason', () => {
  assert.deepEqual(parseRestrictedKey(` rk_test_${'a'.repeat(24)} `), { ok: true, key: `rk_test_${'a'.repeat(24)}`, mode: 'test' });
  const live = parseRestrictedKey(`rk_live_${'B1'.repeat(20)}`);
  assert.equal(live.ok && live.mode, 'live');
  const full = parseRestrictedKey(`sk_live_${'a'.repeat(24)}`);
  assert.equal(full.ok, false);
  if (!full.ok) assert.match(full.error, /full secret key/);
  for (const bad of ['', 'pk_test_abc', 'rk_test_short', 'rk_prod_' + 'a'.repeat(24), 'whsec_' + 'a'.repeat(24), `rk_test_${'a'.repeat(24)}\nextra`]) assert.equal(parseRestrictedKey(bad).ok, false, bad);
});

test('amounts follow each currency’s decimals', () => {
  assert.equal(minorToMajor(2500, 'usd'), 25);
  assert.equal(minorToMajor(500, 'JPY'), 500);
  assert.equal(minorToMajor(1234, 'KWD'), 1.234);
  assert.equal(minorToMajor(1999, 'EUR'), 19.99);
});

test('a succeeded charge becomes a paid revenue row; refunds are subtracted', () => {
  const r = chargeToRow(CH)!;
  assert.deepEqual(r, { external_id: 'ch_3Abc123DEF456', amount: 25, currency: 'USD', paid_at: '2026-09-06', notes: 'Brand deal deposit' });
  const part = chargeToRow({ ...CH, amount_refunded: 500 })!;
  assert.equal(part.amount, 20);
  assert.match(part.notes, /partly refunded/);
  assert.equal(chargeToRow({ ...CH, description: null })!.notes, 'Stripe payment');
});

test('failed, pending, fully refunded and malformed charges are not income', () => {
  for (const bad of [{ ...CH, paid: false }, { ...CH, status: 'failed' }, { ...CH, status: 'pending' }, { ...CH, amount_refunded: 2500 }, { ...CH, amount: 0 }, { ...CH, amount: -5 }, { ...CH, currency: 'dollars' }, { ...CH, created: 0 }, { ...CH, id: 'x; drop table' }, { ...CH, id: 42 }, {}]) {
    assert.equal(chargeToRow(bad as never), null, JSON.stringify(bad));
  }
  assert.equal(chargeIsGone({ ...CH, amount_refunded: 2500 }), 'ch_3Abc123DEF456');
  assert.equal(chargeIsGone(CH), null);
  assert.equal(chargeIsGone({ amount: 5, amount_refunded: 5 }), null);
});
