/**
 * Browser-side helper for POST /api/generate. The route returns the same JSON shape for every kind,
 * so callers get a typed result or a plain error message they can show next to the control.
 */
export type GenerateOk<T> = { ok: true; kind: string; source: 'ai' | 'template'; notice: string | null; result: T };
export type GenerateErr = {
  ok: false;
  error: string;
  code?: string;
  details?: string[] | null;
  missing?: Array<{ field: string; label: string; question: string }> | null;
};
export type GenerateResponse<T> = GenerateOk<T> | GenerateErr;

export async function callGenerate<T>(payload: Record<string, unknown>): Promise<GenerateResponse<T>> {
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // Non-JSON response (for example a gateway error page).
    }
    if (body && typeof body === 'object' && typeof (body as { ok?: unknown }).ok === 'boolean') {
      return body as GenerateResponse<T>;
    }
    return { ok: false, error: res.ok ? 'The server sent an unexpected response. Try again.' : `The request failed (${res.status}). Try again.` };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  }
}
