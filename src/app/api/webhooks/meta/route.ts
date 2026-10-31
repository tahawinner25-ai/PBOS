import { loadIntegrations } from '@/lib/integrations/config';
import { findCreatorByExternalAccount } from '@/lib/integrations/store';
import { parseInstagramWebhook, verifyWebhookChallenge, verifyWebhookSignature } from '@/lib/integrations/webhooks';
import { clientIp, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY = 1_000_000;

/** Subscription verification: Meta calls this once with hub.* parameters when you save the webhook in the app dashboard. */
export async function GET(request: Request) {
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN ?? '';
  const challenge = verifyWebhookChallenge(new URL(request.url).searchParams, expected);
  if (challenge === null) return new Response('forbidden', { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
}

/**
 * Deliveries. The signature is checked over the RAW body with the app secret before anything is parsed.
 * We only record that something happened (no payload values beyond the field name), then answer fast.
 */
export async function POST(request: Request) {
  if (!rateLimit(`meta-hook:${clientIp(request)}`, 600, 60_000).allowed) return json({ error: 'rate_limited' }, 429);
  const secret = process.env.META_APP_SECRET ?? '';
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ error: 'too_large' }, 413);
  if (!verifyWebhookSignature(raw, request.headers.get('x-hub-signature-256'), secret)) return json({ error: 'bad_signature' }, 401);

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'bad_json' }, 400);
  }
  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: true }); // acknowledge so Meta does not retry; nothing to store without a database
  for (const item of parseInstagramWebhook(body).slice(0, 50)) {
    const creatorId = await findCreatorByExternalAccount(setup.db, 'instagram', item.igUserId).catch(() => null);
    await setup.env.events.record(creatorId, 'instagram', `webhook_${item.field}`.slice(0, 60), { field: item.field });
  }
  return json({ ok: true });
}
