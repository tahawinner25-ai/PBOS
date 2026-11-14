import { getCreatorContext } from '@/lib/auth';
import { priceIdForStep, stripe, stripeConfigured, StripeError } from '@/lib/server/stripe';
import { json, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { isActiveStatus } from '@/lib/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts a Stripe Checkout for PBOS Pro at the first price. Card details are typed on Stripe's page, never on ours. */
export async function POST(request: Request) {
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'unauthorized' }, 401);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!rateLimit(`billing-checkout:${ctx.user.id}`, 6, 10 * 60_000).allowed) return json({ error: 'rate_limited', message: 'Too many tries. Wait a few minutes.' }, 429);
  if (!stripeConfigured()) return json({ error: 'not_configured', message: 'Payments are not switched on for this deployment yet.' }, 503);

  const existing = await ctx.supabase.from('subscriptions').select('status, stripe_customer_id').eq('creator_id', ctx.profile.id).maybeSingle();
  if (existing.data && isActiveStatus((existing.data as { status: string }).status)) return json({ error: 'already_subscribed', message: 'You already have PBOS Pro. Use Manage billing to change it.' }, 409);

  const origin = new URL(request.url).origin;
  try {
    const price = await priceIdForStep(0);
    const session = await stripe<{ url?: string }>('POST', '/checkout/sessions', {
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      client_reference_id: ctx.profile.id,
      subscription_data: { metadata: { creator_id: ctx.profile.id } },
      metadata: { creator_id: ctx.profile.id },
      allow_promotion_codes: false,
      success_url: `${origin}/billing?status=success`,
      cancel_url: `${origin}/billing?status=cancelled`,
    });
    if (!session.url) return json({ error: 'failed', message: 'Checkout could not be started. Try again.' }, 502);
    return json({ url: session.url });
  } catch (e) {
    console.error('[billing] checkout failed', e instanceof StripeError ? e.message : 'error');
    return json({ error: 'failed', message: 'Checkout could not be started. Nothing was charged.' }, 502);
  }
}
