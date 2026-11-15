import 'server-only';
import { CURRENCY, PRODUCT_ID, priceLookupKey, stepCents } from '@/lib/billing';
import { MAX_LOOKUP_KEY, MAX_PRICE_CENTS, MAX_PRODUCT_ID } from '@/lib/plans';

/**
 * A small Stripe REST client (no SDK, no extra dependency). Every call has a timeout, the secret key is read only
 * here, and nothing in an error message is ever taken from Stripe's response body beyond its code.
 */

export class StripeError extends Error {
  constructor(public status: number, public code: string) {
    super(`stripe_${status}_${code}`);
  }
}

// Accepts STRIPE_SECRET_KEY (documented name) or STRIPE_SECRET (shorter alias).
const secretKey = () => process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SECRET || '';
export const stripeConfigured = () => /^(sk|rk)_(test|live)_/.test(secretKey());
export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET ?? '';

type Param = string | number | boolean | null | undefined | Param[] | { [k: string]: Param };

function flatten(value: Param, prefix: string, out: Array<[string, string]>) {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  else if (typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}[${k}]` : k, out);
  else out.push([prefix, String(value)]);
}

/** PBOS's own Stripe account (subscriptions). */
export async function stripe<T = Record<string, unknown>>(method: 'GET' | 'POST' | 'DELETE', path: string, params: { [k: string]: Param } = {}, idempotencyKey?: string): Promise<T> {
  if (!stripeConfigured()) throw new StripeError(0, 'not_configured');
  return stripeAs<T>(secretKey(), method, path, params, idempotencyKey);
}

/** Any Stripe key, for example a creator's own restricted key. Errors carry a status and a short code only, never the key. */
export async function stripeAs<T = Record<string, unknown>>(key: string, method: 'GET' | 'POST' | 'DELETE', path: string, params: { [k: string]: Param } = {}, idempotencyKey?: string): Promise<T> {
  const pairs: Array<[string, string]> = [];
  flatten(params, '', pairs);
  const body = new URLSearchParams(pairs);
  const url = `https://api.stripe.com/v1${path}${method === 'GET' && pairs.length ? `?${body.toString()}` : ''}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
    body: method === 'POST' ? body.toString() : undefined,
    signal: AbortSignal.timeout(15_000),
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = (data.error ?? {}) as { code?: string; type?: string };
    throw new StripeError(res.status, String(err.code ?? err.type ?? 'error').slice(0, 60));
  }
  return data as T;
}

const priceIds = new Map<number, string>();

/** The Stripe price for a step. Found by its lookup key, created once if it does not exist (product id is fixed). */
export async function priceIdForStep(step: number): Promise<string> {
  const cents = stepCents(step);
  const cached = priceIds.get(cents);
  if (cached) return cached;
  const found = await stripe<{ data: Array<{ id: string; unit_amount: number; recurring?: { interval: string } }> }>('GET', '/prices', { 'lookup_keys': [priceLookupKey(step)], active: true, limit: 1 });
  const hit = found.data[0];
  if (hit && hit.unit_amount === cents && hit.recurring?.interval === 'month') {
    priceIds.set(cents, hit.id);
    return hit.id;
  }
  try {
    await stripe('GET', `/products/${PRODUCT_ID}`);
  } catch (e) {
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
    await stripe('POST', '/products', { id: PRODUCT_ID, name: 'PBOS Pro', description: 'PBOS Pro, billed monthly.' });
  }
  const made = await stripe<{ id: string }>('POST', '/prices', {
    product: PRODUCT_ID, currency: CURRENCY, unit_amount: cents, recurring: { interval: 'month' }, lookup_key: priceLookupKey(step), transfer_lookup_key: true, nickname: `PBOS Pro $${(cents / 100).toFixed(2)}`,
  }, `pbos-price-${cents}`);
  priceIds.set(cents, made.id);
  return made.id;
}

let maxPriceId: string | null = null;

/** The fixed $50 monthly price of the Max plan. Found by lookup key, created once if missing. */
export async function priceIdForMax(): Promise<string> {
  if (maxPriceId) return maxPriceId;
  const found = await stripe<{ data: Array<{ id: string; unit_amount: number; recurring?: { interval: string } }> }>('GET', '/prices', { lookup_keys: [MAX_LOOKUP_KEY], active: true, limit: 1 });
  const hit = found.data[0];
  if (hit && hit.unit_amount === MAX_PRICE_CENTS && hit.recurring?.interval === 'month') { maxPriceId = hit.id; return hit.id; }
  try {
    await stripe('GET', `/products/${MAX_PRODUCT_ID}`);
  } catch (e) {
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
    await stripe('POST', '/products', { id: MAX_PRODUCT_ID, name: 'PBOS Max', description: 'PBOS Max, billed monthly. No weekly or monthly usage limits.' });
  }
  const made = await stripe<{ id: string }>('POST', '/prices', { product: MAX_PRODUCT_ID, currency: CURRENCY, unit_amount: MAX_PRICE_CENTS, recurring: { interval: 'month' }, lookup_key: MAX_LOOKUP_KEY, transfer_lookup_key: true, nickname: 'PBOS Max $50.00' }, 'pbos-price-max-5000');
  maxPriceId = made.id;
  return made.id;
}
