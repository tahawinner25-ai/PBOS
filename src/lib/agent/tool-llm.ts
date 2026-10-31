/**
 * Anthropic Messages API with tool use, built on fetch (no SDK). Pure: the key, model and fetch are injected,
 * so the agent loop can be tested with a scripted fake. Bound to the environment in src/lib/server/ai.ts.
 */

export type TextBlock = { type: 'text'; text: string };
export type ToolUseBlock = { type: 'tool_use'; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
export type Block = TextBlock | ToolUseBlock | ToolResultBlock;

export type ToolMessage = { role: 'user' | 'assistant'; content: string | Block[] };

export type ToolSchema = { name: string; description: string; input_schema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean } };

export type ToolLlmFailure = 'not_configured' | 'timeout' | 'network' | 'http_error' | 'empty';

export type ToolLlmResult =
  | { ok: true; content: Array<TextBlock | ToolUseBlock>; stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'other' }
  | { ok: false; reason: ToolLlmFailure; detail?: string };

export type ToolLlm = (args: { system: string; messages: ToolMessage[]; tools: ToolSchema[]; maxTokens?: number; timeoutMs?: number }) => Promise<ToolLlmResult>;

export type ToolLlmConfig = { apiKey?: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch };

const DEFAULT_MODEL = 'claude-sonnet-5-5';

export function createToolLlm(cfg: ToolLlmConfig): ToolLlm {
  return async ({ system, messages, tools, maxTokens = 2000, timeoutMs = 40_000 }) => {
    if (!cfg.apiKey) return { ok: false, reason: 'not_configured' };
    const doFetch = cfg.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${cfg.baseUrl ?? 'https://api.anthropic.com'}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: cfg.model || DEFAULT_MODEL,
          max_tokens: maxTokens,
          // The instructions are the same for every turn of a run, so mark them cacheable.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
          tools,
          tool_choice: { type: 'auto' },
          messages,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        let detail = String(res.status);
        try {
          const body = (await res.json()) as { error?: { type?: string } };
          if (body?.error?.type) detail = `${res.status} ${body.error.type}`;
        } catch {
          /* the status code is enough */
        }
        return { ok: false, reason: 'http_error', detail };
      }
      const body = (await res.json()) as { content?: Array<Record<string, unknown>>; stop_reason?: string };
      const content: Array<TextBlock | ToolUseBlock> = [];
      for (const b of body.content ?? []) {
        if (b.type === 'text' && typeof b.text === 'string') content.push({ type: 'text', text: b.text });
        else if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') content.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input });
      }
      if (content.length === 0) return { ok: false, reason: 'empty' };
      const stop = body.stop_reason;
      return { ok: true, content, stopReason: stop === 'end_turn' || stop === 'tool_use' || stop === 'max_tokens' ? stop : 'other' };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { ok: false, reason: 'timeout' };
      return { ok: false, reason: 'network', detail: err instanceof Error ? err.message : undefined };
    } finally {
      clearTimeout(timer);
    }
  };
}
