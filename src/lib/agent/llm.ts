/**
 * Minimal Anthropic Messages API client built on fetch (no SDK dependency).
 * This module is pure so it can be unit-tested with an injected fetch. It must
 * only ever be imported from server code: `src/lib/server/ai.ts` binds it to
 * environment variables and is guarded with `server-only`.
 */

export type LlmFailure = 'not_configured' | 'timeout' | 'network' | 'http_error' | 'empty' | 'bad_json';

export type LlmResult =
  | { ok: true; json: unknown; text: string }
  | { ok: false; reason: LlmFailure; detail?: string };

export type LlmCall = (args: { staticSystem: string; user: string; maxTokens?: number }) => Promise<LlmResult>;

export type LlmConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

/** Parse a JSON object out of model text, tolerating code fences or stray prose. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
  throw new Error('no JSON object found');
}

export function createLlmCaller(cfg: LlmConfig): LlmCall {
  return async ({ staticSystem, user, maxTokens = 1500 }) => {
    if (!cfg.apiKey) return { ok: false, reason: 'not_configured' };
    const doFetch = cfg.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 30_000);
    try {
      const res = await doFetch(`${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model || DEFAULT_MODEL,
          max_tokens: maxTokens,
          // Static creator instructions are marked cacheable so repeat calls reuse them.
          system: [{ type: 'text', text: staticSystem, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: user }],
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = String(res.status);
        try {
          const body = (await res.json()) as { error?: { type?: string; message?: string } };
          if (body?.error?.type) detail = `${res.status} ${body.error.type}`;
        } catch {
          /* ignore body parse errors */
        }
        return { ok: false, reason: 'http_error', detail };
      }
      const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = (body.content ?? [])
        .filter((b) => b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text as string)
        .join('\n')
        .trim();
      if (!text) return { ok: false, reason: 'empty' };
      try {
        return { ok: true, json: extractJson(text), text };
      } catch {
        return { ok: false, reason: 'bad_json' };
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network', detail: err instanceof Error ? err.message : undefined };
    } finally {
      clearTimeout(timer);
    }
  };
}
