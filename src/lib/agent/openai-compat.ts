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
export const COMPAT_DEFAULT_MODEL = 'gemini-flash-latest';

/** Pick a usable chat model from the provider's own list: newest plain "flash", else any flash, else any gemini. */
export function pickModel(ids: string[]): string | null {
  const names = ids.map((i) => i.replace(/^models\//, ''));
  const ver = (n: string) => Number(/gemini-(\d+(?:\.\d+)?)/.exec(n)?.[1] ?? 0);
  const plain = names.filter((n) => /^gemini-[\d.]+-flash$/.test(n)).sort((a, b) => ver(b) - ver(a));
  if (plain[0]) return plain[0];
  return names.find((n) => /flash/.test(n) && !/(image|tts|live|embed|audio)/.test(n)) ?? names.find((n) => /^gemini/.test(n) && !/(image|tts|live|embed|audio)/.test(n)) ?? null;
}

/** Google's free tier sometimes answers 503/429 for one model while another is idle. These are tried in order. */
export const COMPAT_FALLBACK_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash'];
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const usesDefaultProvider = (cfg: CompatConfig) => !cfg.baseUrl;

const discovered = new Map<string, string>();

/** Ask the provider which models this key can use. Used once when the configured model returns "not found". */
async function discoverModel(cfg: CompatConfig): Promise<string | null> {
  const base = (cfg.baseUrl || COMPAT_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const hit = discovered.get(base);
  if (hit) return hit;
  try {
    const res = await (cfg.fetchImpl ?? fetch)(`${base}/models`, { headers: { authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    const m = pickModel((j.data ?? []).map((d) => d.id ?? '').filter(Boolean));
    if (m) discovered.set(base, m);
    return m;
  } catch {
    return null;
  }
}

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

/**
 * Gemini's OpenAI endpoint (and some others) reject JSON-schema keywords the OpenAI spec allows, such as
 * `additionalProperties`, and an object with no properties at all. Strip those so one schema works everywhere. The
 * server still validates every argument itself, so nothing is loosened.
 */
export function sanitizeSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'additionalProperties' || k === '$schema') continue;
    out[k] = sanitizeSchema(v);
  }
  return out;
}

const hasProps = (schema: ToolSchema['input_schema']) => Object.keys(schema.properties ?? {}).length > 0;

export const toOpenAiTools = (tools: ToolSchema[]) =>
  tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, ...(hasProps(t.input_schema) ? { parameters: sanitizeSchema(t.input_schema) } : {}) },
  }));

export type CompatCheck = { ok: true; message: string } | { ok: false; step: 'plain' | 'tools'; status?: number; detail: string };

/** One-off diagnostic: a plain request, then a request that carries the real tool list. Reports the provider's own error text (never the key). */
export async function checkCompatConnection(cfg: CompatConfig, tools: ToolSchema[]): Promise<CompatCheck> {
  if (!cfg.apiKey) return { ok: false, step: 'plain', detail: 'AI_API_KEY is not set on the server.' };
  const models = [cfg.model || COMPAT_DEFAULT_MODEL, ...(usesDefaultProvider(cfg) ? COMPAT_FALLBACK_MODELS : [])];
  const run = async (step: 'plain' | 'tools', body: Record<string, unknown>): Promise<CompatCheck | null> => {
    let last: CompatCheck | null = null;
    for (const model of models) {
      last = await runOne(step, body, model);
      if (!last) return null;
      if (!(last.ok === false && last.status && RETRYABLE.has(last.status))) return last;
    }
    return last;
  };
  const runOne = async (step: 'plain' | 'tools', body: Record<string, unknown>, model: string): Promise<CompatCheck | null> => {
    try {
      const res = await (cfg.fetchImpl ?? fetch)(endpoint(cfg), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model, max_tokens: 200, ...body }),
        signal: AbortSignal.timeout(25_000),
      });
      if (res.ok) return null;
      let text = '';
      try { text = (await res.text()).slice(0, 400); } catch { /* status is enough */ }
      return { ok: false, step, status: res.status, detail: text.replace(cfg.apiKey!, '[key]') };
    } catch (err) {
      return { ok: false, step, detail: err instanceof Error ? err.message : 'network error' };
    }
  };
  const plain = await run('plain', { messages: [{ role: 'user', content: 'Reply with the single word OK.' }] });
  if (plain) return plain;
  const withTools = await run('tools', { messages: [{ role: 'user', content: 'Reply with the single word OK.' }], tools: toOpenAiTools(tools), tool_choice: 'auto' });
  if (withTools) return withTools;
  return { ok: true, message: `The AI provider answered a plain request and a request carrying the agent's ${tools.length} tools (model ${cfg.model || COMPAT_DEFAULT_MODEL}).` };
}

async function post(cfg: CompatConfig, body: Record<string, unknown>, timeoutMs: number, model?: string): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; reason: 'timeout' | 'network' | 'http_error'; detail?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (cfg.fetchImpl ?? fetch)(endpoint(cfg), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: model || cfg.model || COMPAT_DEFAULT_MODEL, ...body }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = String(res.status);
      try {
        const raw = (await res.json()) as unknown;
        const first = (Array.isArray(raw) ? raw[0] : raw) as { error?: { type?: string; message?: string; status?: string } } | null;
        const type = first?.error?.type || first?.error?.status;
        detail = failureDetail(res.status, first ? { error: { type: typeof type === 'string' ? type.toLowerCase() : undefined, message: first.error?.message } } : null);
        // For a 400 the provider's own words say what is wrong (a bad field, a bad model setting). They never contain the key.
        if (res.status === 400 && typeof first?.error?.message === 'string') detail += ` | ${first.error.message.replace(/\s+/g, ' ').slice(0, 300)}`;
      } catch {
        /* the status code is enough */
      }
      if (res.status === 404 && !model) {
        // The model name is unknown to this provider (models get retired). Pick one this key can use and retry once.
        const alt = await discoverModel(cfg);
        if (alt && alt !== (cfg.model || COMPAT_DEFAULT_MODEL)) return post(cfg, body, timeoutMs, alt);
      }
      if (RETRYABLE.has(res.status) && !model && usesDefaultProvider(cfg)) {
        for (const alt of COMPAT_FALLBACK_MODELS) {
          if (alt === (cfg.model || COMPAT_DEFAULT_MODEL)) continue;
          const again = await post(cfg, body, timeoutMs, alt);
          if (again.ok) return again;
        }
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
