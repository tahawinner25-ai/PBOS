import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOOR_CENTS, MAX_STEP, START_CENTS, monthsUntilDrop, priceLookupKey, scheduleRows, stepCents, stepForPeriodsPaid, verifyStripeSignature } from '../src/lib/billing';

test('the price starts at $10.00 and drops $0.25 every 3 paid months down to $5.00', () => {
  assert.equal(stepCents(0), 1000);
  assert.equal(stepCents(1), 975);
  assert.equal(stepCents(2), 950);
  assert.equal(stepCents(20), 500);
  assert.equal(stepCents(99), FLOOR_CENTS, 'never below the floor');
  assert.equal(stepCents(-3), START_CENTS);
  assert.equal(MAX_STEP, 20);
});

test('months 1-3 are step 0, the 4th month is step 1, and it stops at the floor after 60 paid months', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map(stepForPeriodsPaid), [0, 0, 0, 1, 1, 1, 2]);
  assert.equal(stepForPeriodsPaid(59), 19);
  assert.equal(stepForPeriodsPaid(60), 20);
  assert.equal(stepForPeriodsPaid(500), 20);
  assert.equal(monthsUntilDrop(0), 3);
  assert.equal(monthsUntilDrop(2), 1);
  assert.equal(monthsUntilDrop(3), 3);
  assert.equal(monthsUntilDrop(60), null);
});

test('the schedule table has 21 rows, each price has its own lookup key', () => {
  const rows = scheduleRows();
  assert.equal(rows.length, 21);
  assert.equal(rows[0].fromMonth, 1);
  assert.equal(rows[1].fromMonth, 4);
  assert.equal(new Set(rows.map((r) => priceLookupKey(r.step))).size, 21);
  assert.equal(priceLookupKey(1), 'pbos_pro_975');
});

async function sign(raw: string, secret: string, t: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

test('Stripe signatures: valid passes; wrong secret, edited body, old timestamp and junk fail', async () => {
  const raw = '{"id":"evt_1"}';
  const now = 1_800_000_000;
  const good = `t=${now},v1=${await sign(raw, 'whsec_a', now)}`;
  assert.equal(await verifyStripeSignature(raw, good, 'whsec_a', now), true);
  assert.equal(await verifyStripeSignature(raw, good, 'whsec_b', now), false);
  assert.equal(await verifyStripeSignature(raw + ' ', good, 'whsec_a', now), false);
  assert.equal(await verifyStripeSignature(raw, good, 'whsec_a', now + 301), false);
  assert.equal(await verifyStripeSignature(raw, null, 'whsec_a', now), false);
  assert.equal(await verifyStripeSignature(raw, 't=abc,v1=00', 'whsec_a', now), false);
  assert.equal(await verifyStripeSignature(raw, good, '', now), false);
});
