import { createHmac } from 'node:crypto';
import { safeEqual } from '../signing';

/**
 * Meta webhooks and callbacks.
 *
 *  - Verification (GET): Meta sends hub.mode=subscribe, hub.verify_token and hub.challenge. We echo the
 *    challenge only if the token matches ours.
 *  - Events (POST): the body is signed with the app secret and sent as `X-Hub-Signature-256: sha256=<hex>`.
 *    We compute the HMAC over the RAW body bytes and compare in constant time; anything else is rejected
 *    before it is parsed.
 *  - Deauthorize and data-deletion callbacks send `signed_request=<sig>.<payload>`: base64url HMAC-SHA256
 *    of the payload with the app secret, then the JSON payload.
 */

export function verifyWebhookChallenge(query: URLSearchParams, expectedToken: string): string | null {
  if (!expectedToken) return null;
  if (query.get('hub.mode') !== 'subscribe') return null;
  const token = query.get('hub.verify_token');
  const challenge = query.get('hub.challenge');
  if (!token || !challenge || !safeEqual(token, expectedToken)) return null;
  return challenge;
}

export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  return safeEqual(header.slice('sha256='.length), expected);
}

export type SignedRequestPayload = { user_id?: string; algorithm?: string; issued_at?: number };

export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  const dot = signedRequest.indexOf('.');
  if (dot <= 0 || signedRequest.length > 4096 || !appSecret) return null;
  const signature = signedRequest.slice(0, dot);
  const payload = signedRequest.slice(dot + 1);
  const expected = createHmac('sha256', appSecret).update(payload).digest('base64url');
  if (!safeEqual(signature, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SignedRequestPayload;
    return data.algorithm?.toUpperCase() === 'HMAC-SHA256' ? data : null;
  } catch {
    return null;
  }
}

/** What PBOS does with an Instagram webhook delivery. Unknown shapes are ignored, never trusted. */
export type WebhookItem = { igUserId: string; field: string; value: Record<string, unknown> };

export function parseInstagramWebhook(body: unknown): WebhookItem[] {
  if (!body || typeof body !== 'object') return [];
  const payload = body as { object?: unknown; entry?: unknown };
  if (payload.object !== 'instagram' || !Array.isArray(payload.entry)) return [];
  const out: WebhookItem[] = [];
  for (const entry of payload.entry.slice(0, 100)) {
    const e = entry as { id?: unknown; changes?: unknown };
    if (typeof e.id !== 'string' || !Array.isArray(e.changes)) continue;
    for (const change of e.changes.slice(0, 100)) {
      const c = change as { field?: unknown; value?: unknown };
      if (typeof c.field !== 'string') continue;
      out.push({ igUserId: e.id, field: c.field, value: c.value && typeof c.value === 'object' ? (c.value as Record<string, unknown>) : {} });
    }
  }
  return out;
}
