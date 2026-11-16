import { clientIp, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { handleCreatorWebhook } from '@/lib/server/stripe-invoicing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Invoice events from a creator's own Stripe account. Not signed in with Clerk: Stripe calls this. The signature is checked over the
 * raw body with that creator's own signing secret (stored encrypted), and the invoice is re-read from Stripe before anything changes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ creatorId: string }> }) {
  if (!rateLimit(`stripe-creator-hook:${clientIp(request)}`, 300, 60_000).allowed) return json({ error: 'rate_limited' }, 429);
  const { creatorId } = await params;
  if (!UUID.test(creatorId)) return json({ error: 'not_found' }, 404);
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  try {
    const status = await handleCreatorWebhook(creatorId.toLowerCase(), raw, request.headers.get('stripe-signature'));
    return json(status === 200 ? { received: true } : { error: status === 400 ? 'bad_request' : 'failed' }, status);
  } catch (e) {
    console.error('[stripe-creator-webhook] failed', e instanceof Error ? e.message : 'error');
    return json({ error: 'failed' }, 500);
  }
}
