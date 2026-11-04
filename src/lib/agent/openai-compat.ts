/**
 * Any OpenAI-compatible chat endpoint as the AI provider: Google Gemini (free tier, no card), Groq, OpenRouter, a local
 * model server, or OpenAI itself. Built on fetch, pure (key, model, URL and fetch are injected), so it is tested with
 * canned responses. Produces the same ToolLlm / LlmCall shapes as the Anthropic clients, so the agent loop, the
 * validators and every approval rule are unchanged: only the transport differs.
 */
import { failureDetail } from './ai-errors';
import { extractJson, type LlmCall } from './llm';
import type { Block, TextBlock, ToolLlm, ToolMessage, ToolSchema, ToolUseBlock } from './tool-llm';

export type CompatConfig = { apiKey?: string; model?: string; baseUrl?: string; fetchImpl?: typeof fetch };

export const COMPAT_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
export const COMPAT_DEFAULT_MODEL = 'gemini-2.5-flash';

type OaiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

const endpoint = (cfg: CompatConfig) => `${(cfg.baseUrl || COMPAT_DEFAULT_BASE_URL).replace(/\/+$/, '')}/chat/completions`;

/** Anthropic-style blocks to OpenAI chat messages. Tool results become `tool` messages, in order, before any user text. */
export function toOpenAiMessages(system: string, messages: ToolMessage[]): OaiMessage[] {
  const out: OaiMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const blocks = m.content as Block[];
    if (m.role === 'assistant') {
      const text = blocks.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      const calls = blocks.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      out.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) } : {}),
      });
    } else {
      for (const b of blocks) if (b.type === 'tool_result') out.push({ role: 'tool', tool_call_id: b.tool_use_id, content: b.content });
      const text = blocks.filter((b): b is TextBlock => b.type === 'text').map((b) => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}

const toOpenAiTools = (tools: ToolSchema[]) => tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));

async function post(cfg: CompatConfig, body: Record<string, unknown>, timeoutMs: number): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; reason: 'timeout' | 'network' | 'http_error'; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (cfg.fetchImpl ?? fetch)(endpoint(cfg), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model || COMPAT_DEFAULT_MODEL, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = String(res.status);
      try {
        const raw = (await res.json()) as unknown;
        const first = (Array.isArray(raw) ? raw[0] : raw) as { error?: { type?: string; message?: string; status?: string } } | null;
        const type = first?.error?.type || first?.error?.status;
        detail = failureDetail(res.status, first ? { error: { type: typeof type === 'string' ? type.toLowerCase() : undefined, message: first.error?.message } } : null);
      } catch {
        /* the status code is enough */
      }
      return { ok: false, reason: 'http_error', detail };
    }
    return { ok: true, json: (await res.json()) as Record<string, unknown> };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'network', detail: err instanceof Error ? err.message : undefined };
  } finally {
    clearTimeout(timer);
  }
}

type Choice = { message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string };

export function createCompatToolLlm(cfg: CompatConfig): ToolLlm {
  return async ({ system, messages, tools, maxTokens = 2000, timeoutMs = 40_000 }) => {
    if (!cfg.apiKey) return { ok: false, reason: 'not_configured' };
    const r = await post(cfg, { max_tokens: maxTokens, messages: toOpenAiMessages(system, messages), ...(tools.length ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {}) }, timeoutMs);
    if (!r.ok) return r;
    const choice = ((r.json.choices as Choice[] | undefined) ?? [])[0];
    const msg = choice?.message;
    const content: Array<TextBlock | ToolUseBlock> = [];
    if (typeof msg?.content === 'string' && msg.content.trim()) content.push({ type: 'text', text: msg.content });
    (msg?.tool_calls ?? []).forEach((c, i) => {
      if (!c.function?.name) return;
      let input: unknown = {};
      try { input = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { input = { _unparsed: true }; }
      // Some providers omit the call id; the loop needs one to pair the result with the call.
      content.push({ type: 'tool_use', id: c.id || `call_${i}_${Math.random().toString(36).slice(2, 8)}`, name: c.function.name, input });
    });
    if (content.length === 0) return { ok: false, reason: 'empty' };
    const hasCalls = content.some((b) => b.type === 'tool_use');
    const fin = choice?.finish_reason;
    return { ok: true, content, stopReason: hasCalls ? 'tool_use' : fin === 'length' ? 'max_tokens' : fin === 'stop' ? 'end_turn' : 'other' };
  };
}

export function createCompatLlmCaller(cfg: CompatConfig & { timeoutMs?: number }): LlmCall {
  return async ({ staticSystem, user, maxTokens = 1500 }) => {
    if (!cfg.apiKey) return { ok: false, reason: 'not_configured' };
    const r = await post(cfg, { max_tokens: maxTokens, messages: [{ role: 'system', content: staticSystem }, { role: 'user', content: user }] }, cfg.timeoutMs ?? 30_000);
    if (!r.ok) return r;
    const text = String(((r.json.choices as Choice[] | undefined) ?? [])[0]?.message?.content ?? '').trim();
    if (!text) return { ok: false, reason: 'empty' };
    try {
      return { ok: true, json: extractJson(text), text };
    } catch {
      return { ok: false, reason: 'bad_json' };
    }
  };
}
