import 'server-only';
import { createLlmCaller, type LlmCall } from '@/lib/agent/llm';

/**
 * The only place the Anthropic key is read. Server-only: importing this module from a
 * client component fails the build. Reads env at call time so it is never inlined.
 */
export const callLlm: LlmCall = (args) =>
  createLlmCaller({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL,
    timeoutMs: 40_000,
  })(args);
