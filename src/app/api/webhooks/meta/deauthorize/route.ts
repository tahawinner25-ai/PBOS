import { randomBytes } from 'node:crypto';
import { loadIntegrations } from '@/lib/integrations/config';
import { findInstagramByFacebookUser } from '@/lib/integrations/store';
import { parseSignedRequest } from '@/lib/integrations/webhooks';
import { clientIp, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta "Deauthorize callback": the person removed the app in their Facebook/Instagram settings.
 * The request carries a signed_request that we verify with the app secret. We remove the connection
 * and its tokens right away (nothing can be published or synced afterwards). Synced analytics stay
 * until the creator asks for deletion, which the data-deletion callback and the in-app button cover.
 */
export async function POST(request: Request) {
  if (!rateLimit(`meta-deauth:${clientIp(request)}`, 60, 60_000).allowed) return json({ error: 'rate_limited' }, 429);
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  const payload = typeof signed === 'string' && signed.length < 4096 ? parseSignedRequest(signed, process.env.META_APP_SECRET ?? '') : null;
  if (!payload?.user_id) return json({ error: 'invalid' }, 400);

  const setup = loadIntegrations();
  if (!setup.ok) return json({ ok: true });
  const owners = await findInstagramByFacebookUser(setup.db, payload.user_id);
  for (const { creatorId } of owners) {
    await setup.db.from('social_connections').delete().eq('creator_id', creatorId).eq('platform', 'instagram');
    await setup.env.events.record(creatorId, 'instagram', 'deauthorized', { code: randomBytes(4).toString('hex') });
  }
  return json({ ok: true });
}
