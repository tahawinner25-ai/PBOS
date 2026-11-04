import 'server-only';
import { createCompatLlmCaller, createCompatToolLlm } from '@/lib/agent/openai-compat';
import { createLlmCaller, type LlmCall } from '@/lib/agent/llm';
import { createToolLlm, type ToolLlm } from '@/lib/agent/tool-llm';
import { createWebSearch, type WebSearch } from '@/lib/agent/web-search';

/**
 * The only place AI keys are read. Server-only: importing this module from a client component fails the build.
 * Reads env at call time so nothing is inlined.
 *
 * Two providers, chosen by which key is present:
 *  - AI_API_KEY (+ optional AI_BASE_URL, AI_MODEL): any OpenAI-compatible endpoint. The default is Google Gemini's free
 *    tier (key from aistudio.google.com, no card), which costs nothing. Groq and OpenRouter also work.
 *  - ANTHROPIC_API_KEY (+ optional ANTHROPIC_MODEL): Anthropic's own API, used when AI_API_KEY is not set.
 * The agent's rules, validators and approval step do not depend on the provider.
 */
const compat = () => (process.env.AI_API_KEY ? { apiKey: process.env.AI_API_KEY, baseUrl: process.env.AI_BASE_URL || undefined, model: process.env.AI_MODEL || undefined } : null);

export const aiReady = (): boolean => Boolean(process.env.AI_API_KEY || process.env.ANTHROPIC_API_KEY);

export const callLlm: LlmCall = (args) => {
  const c = compat();
  return (c ? createCompatLlmCaller({ ...c, timeoutMs: 40_000 }) : createLlmCaller({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL, timeoutMs: 40_000 }))(args);
};

export function makeToolLlm(): ToolLlm {
  const c = compat();
  return c ? createCompatToolLlm(c) : createToolLlm({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL });
}

/** Web search needs Anthropic's server-side search tool. With another provider the agent is told search is unavailable. */
export function makeWebSearch(): WebSearch | undefined {
  if (process.env.AI_API_KEY || !process.env.ANTHROPIC_API_KEY) return undefined;
  return createWebSearch({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL, toolType: process.env.ANTHROPIC_WEB_SEARCH_TOOL || undefined });
}
