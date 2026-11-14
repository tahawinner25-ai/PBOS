import { getCreatorContext } from '@/lib/auth';
import { stripe, stripeConfigured, StripeError } from '@/lib/server/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { json, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Opens Stripe's own page where the creator updates a card, sees invoices or cancels. Cancelling there needs no help from us. */
export async function POST(request: Request) {
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'unauthorized' }, 401);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  if (!rateLimit(`billing-portal:${ctx.user.id}`, 10, 10 * 60_000).allowed) return json({ error: 'rate_limited', message: 'Too many tries. Wait a few minutes.' }, 429);
  if (!stripeConfigured()) return json({ error: 'not_configured', message: 'Payments are not switched on for this deployment yet.' }, 503);
  // The customer id is not readable by the signed-in role, so it is read with the server key, for this creator only.
  const db = createAdminClient();
  if (!db) return json({ error: 'not_configured', message: 'Billing storage is not set up yet.' }, 503);
  const row = await db.from('subscriptions').select('stripe_customer_id').eq('creator_id', ctx.profile.id).maybeSingle();
  const customer = (row.data as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (!customer) return json({ error: 'no_subscription', message: 'You do not have a subscription to manage.' }, 404);
  try {
    const session = await stripe<{ url?: string }>('POST', '/billing_portal/sessions', { customer, return_url: `${new URL(request.url).origin}/billing` });
    if (!session.url) return json({ error: 'failed', message: 'The billing page could not be opened.' }, 502);
    return json({ url: session.url });
  } catch (e) {
    console.error('[billing] portal failed', e instanceof StripeError ? e.message : 'error');
    return json({ error: 'failed', message: 'The billing page could not be opened. Try again in a moment.' }, 502);
  }
}
