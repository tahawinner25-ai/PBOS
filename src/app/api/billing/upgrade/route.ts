import { getCreatorContext } from '@/lib/auth';
import { priceIdForMax, stripe, stripeConfigured, StripeError } from '@/lib/server/stripe';
import { json, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { isActiveStatus } from '@/lib/billing';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Moves an active PBOS Pro subscriber to PBOS Max. It only runs from the Upgrade button, after the person confirms.
 * Stripe prorates and invoices the difference right away (always_invoice), on the card they already have on file. With create_prorations the charge would only appear on the next renewal invoice.
 */
export async function POST(request: Request) {
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'unauthorized' }, 401);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!rateLimit(`billing-upgrade:${ctx.user.id}`, 3, 10 * 60_000).allowed) return json({ error: 'rate_limited', message: 'Too many tries. Wait a few minutes.' }, 429);
  if (!stripeConfigured()) return json({ error: 'not_configured', message: 'Payments are not switched on for this deployment yet.' }, 503);

  const admin = createAdminClient();
  if (!admin) return json({ error: 'failed', message: 'The upgrade could not be started.' }, 503);
  const row = await admin.from('subscriptions').select('status, plan, stripe_subscription_id').eq('creator_id', ctx.profile.id).maybeSingle();
  const sub = row.data as { status: string; plan: string; stripe_subscription_id: string | null } | null;
  if (!sub || !sub.stripe_subscription_id || !isActiveStatus(sub.status)) return json({ error: 'no_subscription', message: 'Subscribe first, then you can upgrade.' }, 409);
  if (sub.plan === 'max') return json({ error: 'already_max', message: 'You are already on Max.' }, 409);

  try {
    const live = await stripe<{ items: { data: Array<{ id: string }> } }>('GET', `/subscriptions/${sub.stripe_subscription_id}`);
    const item = live.items.data[0];
    if (!item) return json({ error: 'failed', message: 'The upgrade could not be started. Nothing was charged.' }, 502);
    const price = await priceIdForMax();
    await stripe('POST', `/subscriptions/${sub.stripe_subscription_id}`, { items: [{ id: item.id, price }], proration_behavior: 'always_invoice', metadata: { creator_id: ctx.profile.id, plan: 'max' } }, `pbos-upgrade-${sub.stripe_subscription_id}-max`);
    // The webhook records the new plan; set it now too so the page is right straight away.
    await admin.from('subscriptions').update({ plan: 'max', updated_at: new Date().toISOString() }).eq('creator_id', ctx.profile.id);
    return json({ ok: true });
  } catch (e) {
    console.error('[billing] upgrade failed', e instanceof StripeError ? e.message : 'error');
    return json({ error: 'failed', message: 'The upgrade did not go through. Check Manage billing to see whether you were charged.' }, 502);
  }
}
