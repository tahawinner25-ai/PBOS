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
  if (/credit_balance/.test(detail)) return 'The Anthropic account has no credit left. Add credit at console.anthropic.com → Billing, then try again.';
  if (/^401\b|authentication_error/.test(detail)) return 'Anthropic rejected the API key. Create a new key at console.anthropic.com → API Keys and update ANTHROPIC_API_KEY in Vercel.';
  if (/^403\b|permission_error/.test(detail)) return 'This Anthropic key is not allowed to use that model. Check the key’s workspace and permissions in the Anthropic Console.';
  if (/^404\b|not_found_error/.test(detail)) return 'Anthropic does not know the model name. Remove ANTHROPIC_MODEL in Vercel to use the default, or set a model your account can use.';
  if (/^429\b|rate_limit_error/.test(detail)) return 'Anthropic is rate limiting this key right now. Wait a minute and try again.';
  if (/^529\b|overloaded_error|^5\d\d\b|api_error/.test(detail)) return 'Anthropic is overloaded or having a problem right now. Try again in a few minutes.';
  if (/^400\b|invalid_request_error/.test(detail)) return 'Anthropic refused the request as invalid. The server log has the status code.';
  return null;
}
