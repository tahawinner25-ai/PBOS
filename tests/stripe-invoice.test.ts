import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INVOICE_EVENTS, invoiceUpdate, isHttpsUrl, isInvoiceId, majorToMinor } from '../src/lib/stripe-invoice';

test('majorToMinor: cents, zero- and three-decimal currencies, and amounts that cannot be exact', () => {
  assert.equal(majorToMinor(49.67, 'usd'), 4967);
  assert.equal(majorToMinor(1200, 'USD'), 120000);
  assert.equal(majorToMinor(500, 'JPY'), 500);
  assert.equal(majorToMinor(1.5, 'KWD'), 1500);
  assert.equal(majorToMinor(0, 'USD'), null);
  assert.equal(majorToMinor(-5, 'USD'), null);
  assert.equal(majorToMinor(0.001, 'USD'), null);
  assert.equal(majorToMinor(10, 'US'), null);
  assert.equal(majorToMinor(Number.NaN, 'USD'), null);
  assert.equal(majorToMinor(1e12, 'USD'), null);
});

test('invoiceUpdate follows what Stripe reports', () => {
  const now = Math.floor(Date.parse('2026-11-16T12:00:00Z') / 1000);
  assert.deepEqual(invoiceUpdate({ status: 'paid', status_transitions: { paid_at: now - 86400 } }, now), { status: 'paid', paid_at: '2026-11-15' });
  assert.deepEqual(invoiceUpdate({ status: 'paid' }, now), { status: 'paid', paid_at: '2026-11-16' });
  assert.deepEqual(invoiceUpdate({ status: 'open', due_date: now + 86400 }, now), { status: 'invoiced' });
  assert.deepEqual(invoiceUpdate({ status: 'open', due_date: now - 1 }, now), { status: 'overdue' });
  assert.deepEqual(invoiceUpdate({ status: 'uncollectible' }, now), { status: 'overdue' });
  assert.deepEqual(invoiceUpdate({ status: 'void' }, now), { voided: true });
  assert.equal(invoiceUpdate({ status: 'draft' }, now), null);
  assert.equal(invoiceUpdate({}, now), null);
});

test('ids and urls are checked before they are stored', () => {
  assert.ok(isInvoiceId('in_1Uc6heR7ybLRNwAATTrGcdRb'));
  assert.equal(isInvoiceId('ch_123456'), false);
  assert.equal(isInvoiceId('in_ x'), false);
  assert.ok(isHttpsUrl('https://invoice.stripe.com/i/acct_1/test_abc'));
  assert.equal(isHttpsUrl('http://invoice.stripe.com/x'), false);
  assert.equal(isHttpsUrl('javascript:alert(1)'), false);
  assert.ok(INVOICE_EVENTS.includes('invoice.paid'));
});
