import { randomUUID } from 'node:crypto';
import { agentSystem } from '@/lib/agent/agent-prompt';
import { cleanHistory, MESSAGE_MAX } from '@/lib/agent/request';
import { runAgent, type RunResult } from '@/lib/agent/runner';
import { getCreatorContext } from '@/lib/auth';
import { createToolLlm } from '@/lib/agent/tool-llm';
import { createAdminClient } from '@/lib/supabase/admin';
import { createActionStore } from '@/lib/server/agent-log';
import { buildRuntimeTools, dataNumbersFor } from '@/lib/server/agent-tools';
import { loadAgentData } from '@/lib/server/data';
import { json, readJsonObject, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Daily cap on runs per creator. Each run calls the AI several times, so it is the costliest thing a creator can trigger. */
function dailyRunLimit(): number {
  const n = Number.parseInt(process.env.AGENT_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 30;
}

/**
 * Runs the in-app agent for the signed-in creator. It can read the creator's workspace and make new drafts;
 * anything that would change an existing record comes back as a pending approval. See src/lib/agent/runner.ts
 * for the rules the loop enforces in code.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'Sign in to use the agent.' }, 401);

  const body = await readJsonObject(request, 24_000);
  if (body === null) return json({ error: 'The request body must be a small JSON object.' }, 400);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (message.length < 3) return json({ error: 'Tell the agent what you need first.' }, 400);
  if (message.length > MESSAGE_MAX) return json({ error: `Keep the request under ${MESSAGE_MAX} characters.` }, 400);

  const burst = rateLimit(`agent-run:${ctx.profile.id}`, 4, 60_000);
  if (!burst.allowed) return json({ error: `Too many requests in a minute. Wait ${burst.retryAfterSec}s.` }, 429, { 'Retry-After': String(burst.retryAfterSec) });
  const hourly = rateLimit(`agent-run-hour:${ctx.profile.id}`, 30, 3_600_000);
  if (!hourly.allowed) return json({ error: 'Hourly limit reached for the agent. Try again later.' }, 429, { 'Retry-After': String(hourly.retryAfterSec) });

  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ error: 'AI is not set up on this server (ANTHROPIC_API_KEY is missing), so the agent cannot work yet. The daily review on the dashboard still works from rules.', code: 'ai_unavailable' }, 503);
  }

  // Daily cap through the shared counter (needs the service key; without it only the per-minute limits above apply).
  const admin = createAdminClient();
  if (admin) {
    const bumped = await admin.rpc('bump_api_usage', { p_creator: ctx.profile.id, p_provider: 'agent', p_bucket: 'run', p_day: new Date().toISOString().slice(0, 10), p_units: 1 });
    if (bumped.error) console.error('[api/agent/run] usage counter failed:', bumped.error.code);
    else if (Number(bumped.data ?? 0) > dailyRunLimit()) return json({ error: `You have used today’s ${dailyRunLimit()} agent requests. The allowance resets at midnight UTC.` }, 429);
  }

  try {
    const now = () => new Date();
    const data = await loadAgentData(ctx.supabase, ctx.profile);
    const runId = randomUUID();
    const result: RunResult = await runAgent({
      llm: createToolLlm({ apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL }),
      system: agentSystem(ctx.profile, now().toISOString().slice(0, 10)),
      tools: buildRuntimeTools({ ctx, data, now }),
      history: cleanHistory(body.history),
      message,
      runId,
      store: createActionStore(ctx.supabase, ctx.profile.id),
      now: () => Date.now(),
      dataNumbers: dataNumbersFor(data, now()),
    });
    if (!result.ok) return json({ error: result.message, code: result.code, actions: result.actions }, result.code === 'ai_unavailable' ? 503 : 502);
    return json({ runId, reply: result.reply, notice: result.notice, actions: result.actions, stopped: result.stopped });
  } catch (err) {
    console.error('[api/agent/run]', err instanceof Error ? err.message : 'unknown');
    return json({ error: 'The agent could not finish. Anything it already made is listed in your activity. Try again in a moment.' }, 500);
  }
}

export async function GET() {
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
