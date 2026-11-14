import 'server-only';
import { createHash } from 'node:crypto';

/**
 * Server-side PostHog events for business moments (a subscription started, a price step applied). The person is a one-way
 * hash of the creator id: no email, no name, no content. Silent when no PostHog key is set, and never allowed to break a request.
 */
export async function captureServer(event: string, creatorId: string, properties: Record<string, string | number | boolean> = {}): Promise<void> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com';
  const distinct = `creator_${createHash('sha256').update(creatorId).digest('hex').slice(0, 24)}`;
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, event, distinct_id: distinct, properties: { ...properties, $process_person_profile: false, source: 'server' } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Analytics must never affect billing.
  }
}
