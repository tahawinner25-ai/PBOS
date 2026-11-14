import 'server-only';
import { PRODUCT_ID, stepCents, stepForPeriodsPaid } from '@/lib/billing';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureServer } from '@/lib/server/analytics';
import { priceIdForStep, stripe } from '@/lib/server/stripe';

/**
 * Keeps the subscriptions table equal to what Stripe says, and moves a subscriber to the next price after every 3 paid
 * months. Everything here is idempotent: the paid-month count is read from Stripe's list of paid invoices (not incremented),
 * so a webhook that is delivered twice, late or out of order ends in the same state.
 */

type StripeSub = {
  id: string; customer: string; status: string; cancel_at_period_end?: boolean; current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: Array<{ id: string; current_period_end?: number; price: { id: string; product: string | { id: string } } }> };
};
type Invoice = { id: string; subscription?: string | null; parent?: { subscription_details?: { subscription?: string } } | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'paused'];
const productOf = (s: StripeSub) => { const p = s.items.data[0]?.price.product; return typeof p === 'string' ? p : p?.id; };
export const isOurs = (s: StripeSub) => productOf(s) === PRODUCT_ID;

function db() {
  const client = createAdminClient();
  if (!client) throw new Error('no_database');
  return client;
}

export async function syncSubscription(sub: StripeSub): Promise<string | null> {
  if (!isOurs(sub) || !STATUSES.includes(sub.status)) return null;
  const supabase = db();
  let creatorId = sub.metadata?.creator_id && UUID.test(sub.metadata.creator_id) ? sub.metadata.creator_id : null;
  if (!creatorId) {
    const known = await supabase.from('subscriptions').select('creator_id').eq('stripe_subscription_id', sub.id).maybeSingle();
    creatorId = (known.data as { creator_id?: string } | null)?.creator_id ?? null;
  }
  if (!creatorId) return null;
  const end = sub.current_period_end ?? sub.items.data[0]?.current_period_end;
  const { error } = await supabase.from('subscriptions').upsert({
    creator_id: creatorId, stripe_customer_id: sub.customer, stripe_subscription_id: sub.id, status: sub.status,
    cancel_at_period_end: Boolean(sub.cancel_at_period_end), current_period_end: end ? new Date(end * 1000).toISOString() : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'creator_id' });
  if (error) throw new Error('db_write_failed');
  return creatorId;
}

export async function onCheckoutCompleted(subscriptionId: string): Promise<void> {
  const sub = await stripe<StripeSub>('GET', `/subscriptions/${subscriptionId}`);
  const creatorId = await syncSubscription(sub);
  if (creatorId) await captureServer('subscription_started', creatorId, { price_cents: stepCents(0) });
}

export async function onInvoicePaid(invoice: Invoice): Promise<void> {
  const subId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  if (!subId) return;
  const sub = await stripe<StripeSub>('GET', `/subscriptions/${subId}`);
  const creatorId = await syncSubscription(sub);
  if (!creatorId) return;

  const paid = await stripe<{ data: Array<{ amount_paid: number }> }>('GET', '/invoices', { subscription: subId, status: 'paid', limit: 100 });
  const periodsPaid = paid.data.filter((i) => i.amount_paid > 0).length;
  const target = stepForPeriodsPaid(periodsPaid);

  const supabase = db();
  const row = await supabase.from('subscriptions').select('price_step').eq('creator_id', creatorId).maybeSingle();
  const current = (row.data as { price_step?: number } | null)?.price_step ?? 0;
  if (target > current) {
    const item = sub.items.data[0];
    const price = await priceIdForStep(target);
    // Takes effect on the next invoice; nothing is refunded or charged now.
    if (item.price.id !== price) await stripe('POST', `/subscriptions/${subId}`, { items: [{ id: item.id, price }], proration_behavior: 'none' }, `pbos-step-${subId}-${target}`);
  }
  const { error } = await supabase.from('subscriptions').update({ periods_paid: periodsPaid, price_step: Math.max(current, target), updated_at: new Date().toISOString() }).eq('creator_id', creatorId);
  if (error) throw new Error('db_write_failed');
  if (target > current) await captureServer('price_step_applied', creatorId, { step: target, price_cents: stepCents(target) });
}

export async function onSubscriptionChanged(sub: StripeSub): Promise<void> {
  const creatorId = await syncSubscription(sub);
  if (creatorId && sub.status === 'canceled') await captureServer('subscription_canceled', creatorId, {});
}
