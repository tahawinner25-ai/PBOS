import 'server-only';
import { NotConnectedError, ReauthRequiredError } from '@/lib/integrations/connections';
import { IntegrationError } from '@/lib/integrations/errors';
import { JobStateError, OffsetMismatchError } from '@/lib/integrations/publish';
import { json } from '@/lib/server/http';

/** Maps engine errors to safe JSON responses. Messages are ours (userMessage), never raw provider text. */
export function publishErrorResponse(err: unknown) {
  if (err instanceof OffsetMismatchError) return json({ error: 'The upload position changed. Resuming.', expected: err.expected }, 409);
  if (err instanceof JobStateError) return json({ error: err.message }, 409);
  if (err instanceof NotConnectedError) return json({ error: 'YouTube is not connected. Connect it from Connections first.' }, 409);
  if (err instanceof ReauthRequiredError) return json({ error: 'YouTube needs to be reconnected. Reconnect it from Connections, then retry.' }, 409);
  if (err instanceof IntegrationError) {
    const status = err.kind === 'quota' || err.kind === 'rate_limit' ? 429 : err.kind === 'transient' ? 503 : err.kind === 'auth' || err.kind === 'permission' ? 403 : 422;
    return json({ error: err.userMessage }, status);
  }
  console.error('[publish] unexpected error', err instanceof Error ? err.name : typeof err);
  return json({ error: 'Something went wrong on the server. Nothing was published.' }, 500);
}
