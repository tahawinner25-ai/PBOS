import { verifyStripeSignature } from '@/lib/billing';
import { onCheckoutCompleted, onInvoicePaid, onSubscriptionChanged } from '@/lib/server/billing-sync';
import { clientIp, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { webhookSecret } from '@/lib/server/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 1_000_000;

/**
 * Stripe's deliveries. The signature is checked over the RAW body with the webhook secret, and the timestamp must be recent,
 * before anything is parsed. Handlers re-read the facts from Stripe (not from this payload), so a forged or replayed body cannot
 * move money state. A failure answers 500 so Stripe retries; an event we do not use answers 200.
 */
export async function POST(request: Request) {
  if (!rateLimit(`stripe-hook:${clientIp(request)}`, 300, 60_000).allowed) return json({ error: 'rate_limited' }, 429);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  if (!(await verifyStripeSignature(raw, request.headers.get('stripe-signature'), webhookSecret(), Math.floor(Date.now() / 1000)))) return json({ error: 'bad_signature' }, 400);

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const object = event.data?.object ?? {};
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        if (typeof object.subscription === 'string') await onCheckoutCompleted(object.subscription);
        break;
      case 'invoice.paid':
        await onInvoicePaid(object as never);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await onSubscriptionChanged(object as never);
        break;
      default:
        break;
    }
    return json({ received: true });
  } catch (e) {
    console.error('[stripe-webhook] failed', event.type, e instanceof Error ? e.message : 'error');
    return json({ error: 'failed' }, 500);
  }
}
