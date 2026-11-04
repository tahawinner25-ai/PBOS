/**
 * Turns an Anthropic HTTP failure into a sentence the owner can act on. The detail string is "<status> <error type>",
 * optionally followed by "credit_balance" (Anthropic reports an empty balance as a 400 whose message mentions credit).
 * No key, request body or answer text is ever included.
 */

export function failureDetail(status: number, body: { error?: { type?: string; message?: string } } | null): string {
  let detail = String(status);
  if (body?.error?.type) detail = `${status} ${body.error.type}`;
  if (typeof body?.error?.message === 'string' && /credit balance/i.test(body.error.message)) detail += ' credit_balance';
  return detail;
}

/** A specific explanation for an http_error, or null when the detail says nothing more than "an error". */
export function explainAiError(detail: string | undefined): string | null {
  if (!detail) return null;
  if (/credit_balance/.test(detail)) return 'The AI account has no credit or free quota left (no credit left). Wait for the quota to reset, or use another key, then try again.';
  if (/^401\b|authentication_error/.test(detail)) return 'The AI provider rejected the API key. Create a new key and update AI_API_KEY (or ANTHROPIC_API_KEY) in Vercel.';
  if (/^403\b|permission_error/.test(detail)) return 'This AI key is not allowed to use that model. Check the key’s permissions with the provider.';
  if (/^404\b|not_found_error/.test(detail)) return 'The AI provider does not know the model name. Set AI_MODEL (or remove ANTHROPIC_MODEL) to a model your account can use.';
  if (/^429\b|rate_limit_error/.test(detail)) return 'The AI provider is rate limiting this key right now (free tiers allow only a few requests a minute). Wait a minute and try again.';
  if (/^529\b|overloaded_error|^5\d\d\b|api_error/.test(detail)) return 'The AI provider is overloaded or having a problem right now. Try again in a few minutes.';
  if (/^400\b|invalid_request_error/.test(detail)) return 'The AI provider refused the request as invalid. The server log has the status code.';
  return null;
}
