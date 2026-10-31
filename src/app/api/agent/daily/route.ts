import { analyzeDaily, buildDailyPlan } from '@/lib/agent/daily';
import { getCreatorContext } from '@/lib/auth';
import { callLlm } from '@/lib/server/ai';
import { persistRun } from '@/lib/server/agent-store';
import { loadAgentData } from '@/lib/server/data';
import { json, readJsonObject, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { rules } from '@/lib/validation';

// Cookie-authenticated and personalised: never statically cached. The LLM call needs the Node runtime.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const MIN_INTERVAL_MS = 15_000;

/**
 * Daily operator loop: SCAN → FLAG → SUGGEST → DRAFT. The caller supplies a creator_id (optional);
 * it must be the signed-in creator's own profile id. Only that creator's records are read, the
 * deterministic checks run before the LLM, and the LLM output is validated before anything is saved.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);

  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'Sign in to run the daily loop.' }, 401);

  const body = await readJsonObject(request);
  if (body === null) return json({ error: 'The request body must be a small JSON object.' }, 400);

  let creatorId = ctx.profile.id;
  if (body.creator_id !== undefined && body.creator_id !== null && body.creator_id !== '') {
    const parsed = rules.uuid()(body.creator_id, 'creator_id');
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    // Do not reveal whether another creator's id exists: any mismatch is simply forbidden.
    if (parsed.value !== ctx.profile.id) return json({ error: 'You can only run the loop for your own creator profile.' }, 403);
    creatorId = parsed.value;
  }

  const burst = rateLimit(`daily:${creatorId}`, 1, MIN_INTERVAL_MS);
  if (!burst.allowed) {
    return json(
      { error: `The loop just ran. Wait ${burst.retryAfterSec}s before refreshing.`, retry_after_seconds: burst.retryAfterSec },
      429,
      { 'Retry-After': String(burst.retryAfterSec) },
    );
  }
  const hourly = rateLimit(`daily-hour:${creatorId}`, 20, 3_600_000);
  if (!hourly.allowed) {
    return json({ error: 'Hourly limit reached for the daily loop. Try again later.', retry_after_seconds: hourly.retryAfterSec }, 429, {
      'Retry-After': String(hourly.retryAfterSec),
    });
  }

  try {
    const now = new Date();
    const data = await loadAgentData(ctx.supabase, ctx.profile);
    const plan = buildDailyPlan(data, now);
    const analysis = await analyzeDaily(plan, data, callLlm);

    const runId = crypto.randomUUID();
    const ids = await persistRun(ctx.supabase, creatorId, runId, analysis);

    return json({
      run_id: runId,
      created_at: now.toISOString(),
      status: analysis.status,
      source: analysis.source,
      message: analysis.message,
      fallback: analysis.fallback ?? null,
      learning: analysis.learning,
      flags: analysis.flags.map((f) => ({ ...f, event_id: ids.flags[f.key] ?? null })),
      recommendations: analysis.recommendations.map((r) => ({ ...r, event_id: ids.suggestions[r.key] ?? null })),
      draft: analysis.draft ? { ...analysis.draft, event_id: ids.draft } : null,
    });
  } catch (err) {
    console.error('[api/agent/daily]', err);
    return json({ error: 'The daily loop could not complete. Nothing was shown as a result. Try again in a moment.' }, 500);
  }
}

export async function GET() {
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
