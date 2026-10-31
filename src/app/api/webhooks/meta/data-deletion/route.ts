import { randomBytes } from 'node:crypto';
import { siteUrl } from '@/lib/env';
import { loadIntegrations } from '@/lib/integrations/config';
import { deleteInstagramData, findInstagramByFacebookUser } from '@/lib/integrations/store';
import { parseSignedRequest } from '@/lib/integrations/webhooks';
import { clientIp, json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Meta "Data deletion request callback". Verifies the signed_request, deletes everything we hold that
 * came from the person's Instagram connection, and answers with the JSON Meta requires: a status URL
 * and a confirmation code. The status page (/data-deletion?code=...) reads the code from the event log.
 */
export async function POST(request: Request) {
  if (!rateLimit(`meta-del:${clientIp(request)}`, 30, 60_000).allowed) return json({ error: 'rate_limited' }, 429);
  const form = await request.formData().catch(() => null);
  const signed = form?.get('signed_request');
  const payload = typeof signed === 'string' && signed.length < 4096 ? parseSignedRequest(signed, process.env.META_APP_SECRET ?? '') : null;
  if (!payload?.user_id) return json({ error: 'invalid' }, 400);

  const code = randomBytes(8).toString('hex');
  const setup = loadIntegrations();
  if (setup.ok) {
    const owners = await findInstagramByFacebookUser(setup.db, payload.user_id);
    for (const { creatorId } of owners) {
      await deleteInstagramData(setup.db, creatorId);
      await setup.env.events.record(creatorId, 'instagram', 'data_deleted', { code });
    }
    // Also log when nobody matched, so the status page can still show the request as handled.
    if (owners.length === 0) await setup.env.events.record(null, 'instagram', 'data_deleted', { code, matched: 0 });
  }
  return json({ url: `${siteUrl()}/data-deletion?code=${code}`, confirmation_code: code });
}
