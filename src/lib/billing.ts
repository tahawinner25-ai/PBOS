/**
 * PBOS Pro pricing. Pure: no network, no secrets, so it can be tested.
 *
 * The price starts at $10.00 a month. After every 3 paid months it drops by $0.25, until it reaches $5.00 and stays there.
 * Step 0 = $10.00, step 1 = $9.75, ... step 20 = $5.00. A subscriber keeps the step they have reached; the schedule is
 * per subscriber, counted in paid months, not by the calendar.
 */

export const START_CENTS = 1000;
export const FLOOR_CENTS = 500;
export const DROP_CENTS = 25;
export const MONTHS_PER_STEP = 3;
export const MAX_STEP = (START_CENTS - FLOOR_CENTS) / DROP_CENTS; // 20
export const CURRENCY = 'usd';
export const PRODUCT_ID = 'pbos_pro';

export const stepCents = (step: number): number => START_CENTS - DROP_CENTS * Math.min(Math.max(Math.trunc(step), 0), MAX_STEP);

/** The step a subscriber should be on after `periodsPaid` paid months: the first 3 months are step 0. */
export const stepForPeriodsPaid = (periodsPaid: number): number => Math.min(MAX_STEP, Math.floor(Math.max(0, periodsPaid) / MONTHS_PER_STEP));

/** Lookup key of the Stripe price for a step, so prices can be found again instead of being created twice. */
export const priceLookupKey = (step: number): string => `pbos_pro_${stepCents(step)}`;

export const formatUsd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/** Months until the next price drop for someone who has paid `periodsPaid` months; null once at the floor. */
export function monthsUntilDrop(periodsPaid: number): number | null {
  if (stepForPeriodsPaid(periodsPaid) >= MAX_STEP) return null;
  return MONTHS_PER_STEP - (Math.max(0, periodsPaid) % MONTHS_PER_STEP);
}

/** The whole schedule, for the pricing table. */
export function scheduleRows(): Array<{ step: number; cents: number; fromMonth: number }> {
  return Array.from({ length: MAX_STEP + 1 }, (_, step) => ({ step, cents: stepCents(step), fromMonth: step * MONTHS_PER_STEP + 1 }));
}

/** Plans in which the creator has paid access. */
export const isActiveStatus = (status: string | null | undefined): boolean => status === 'active' || status === 'trialing' || status === 'past_due';

/** Stripe webhook signature check (v1, HMAC-SHA256 over `${timestamp}.${rawBody}`), with a replay window. */
export async function verifyStripeSignature(raw: string, header: string | null, secret: string, nowSec: number, toleranceSec = 300): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || sigs.length === 0 || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${raw}`)));
  const expected = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  let ok = false;
  for (const s of sigs) {
    if (s.length !== expected.length) continue;
    let diff = 0;
    for (let i = 0; i < s.length; i++) diff |= s.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff === 0) ok = true;
  }
  return ok;
}
