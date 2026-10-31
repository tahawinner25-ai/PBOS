import type { Pillar } from '../constants';
import { todayISO } from '../dates';
import { STALE_DAYS } from '../constants';
import { runChecks, selectDraftIntent } from './checks';
import { analyzeFeedback, type Feedback } from './learn';
import type { LlmCall, LlmFailure } from './llm';
import { staticSystemBlock, staticProfileContext } from './prompt';
import { minimalRecord } from './sources';
import type { AgentData, Candidate, DraftIntent, DraftOutput, Flag, Recommendation } from './types';
import { collectNumbers, validateDaily } from './validate';

export type DailyPlan = {
  now: Date;
  flags: Flag[];
  /** Non-suppressed candidates, best first. */
  ranked: Candidate[];
  /** Up to three recommendations to surface. */
  top: Candidate[];
  feedback: Feedback;
  draftIntent: DraftIntent | null;
  allowedIds: Set<string>;
  hasRecords: boolean;
};

export type DailyStatus = 'ok' | 'fallback' | 'clear' | 'no_data';

export type DailyAnalysis = {
  status: DailyStatus;
  source: 'llm' | 'rules';
  flags: Flag[];
  recommendations: Recommendation[];
  draft: DraftOutput | null;
  learning: string[];
  message: string | null;
  fallback?: { reason: string; message: string; details?: string[] };
};

/** SCAN → FLAG → rank/suppress using LEARN. Pure and deterministic. */
export function buildDailyPlan(data: AgentData, now: Date): DailyPlan {
  const checks = runChecks(data, now);
  const feedback = analyzeFeedback(data.events, now);

  const ranked = checks.candidates
    .filter((c) => !feedback.suppressed.has(c.key))
    .map((c) => ({ c, s: c.score + feedback.pillarAdjust[c.pillar] }))
    .sort((a, b) => b.s - a.s || a.c.key.localeCompare(b.c.key))
    .map((x) => x.c);

  const top = ranked.slice(0, 3);
  const activeKeys = new Set(ranked.map((c) => c.key));
  const draftIntent = selectDraftIntent(data, activeKeys, now);

  const allowedIds = new Set<string>();
  checks.flags.forEach((f) => f.source_record_ids.forEach((id) => allowedIds.add(id)));
  top.forEach((c) => c.source_record_ids.forEach((id) => allowedIds.add(id)));
  draftIntent?.source_record_ids.forEach((id) => allowedIds.add(id));

  const hasRecords = data.ideas.length + data.posts.length + data.deals.length + data.revenue.length > 0;
  return { now, flags: checks.flags, ranked, top, feedback, draftIntent, allowedIds, hasRecords };
}

/** Only the variable context the model needs: findings, the records they cite, and the draft brief. */
export function buildLlmContext(plan: DailyPlan, data: AgentData): Record<string, unknown> {
  const records = Array.from(plan.allowedIds)
    .map((id) => minimalRecord(id, data, plan.now))
    .filter((r): r is Record<string, unknown> => r !== null);
  return {
    today: todayISO(plan.now),
    thresholds: { stale_days: STALE_DAYS },
    flags: plan.flags.map((f) => ({ pillar: f.pillar, message: f.message, source_record_ids: f.source_record_ids })),
    findings: plan.top.map((c) => ({
      pillar: c.pillar,
      action: c.action,
      reason: c.reason,
      source_record_ids: c.source_record_ids,
      facts: c.facts,
    })),
    records,
    draft_intent: plan.draftIntent
      ? {
          draft_type: plan.draftIntent.draftType,
          platform: plan.draftIntent.platform,
          instruction: plan.draftIntent.instruction,
          source_record_ids: plan.draftIntent.source_record_ids,
          context: plan.draftIntent.context,
        }
      : null,
  };
}

const RULES = `TASK: daily_loop
Return ONE JSON object: {"flags":[{"pillar","message","source_record_ids"}],"recommendations":[{"pillar","action","reason","source_record_ids"}],"draft":{"type","platform","content"} or null}
RULES:
- flags: rewrite each entry of CONTEXT.flags in plain operator language. Keep pillar and source_record_ids exactly as given. Do not add flags.
- recommendations: one per entry of CONTEXT.findings, same order, at most three. Make action and reason specific. Keep pillar and source_record_ids exactly as given. Do not add recommendations.
- Use only facts present in CONTEXT and the creator profile. Do not add numbers, names or claims. Never promise income, growth, reach or deal outcomes.
- If a finding is a question about missing profile data, keep it as one targeted question.
- draft: null when CONTEXT.draft_intent is null. Otherwise write that asset using its draft_type and platform exactly. Emails are plain text starting with "Subject: ..." and signed with the creator name. No binding legal language. Use bracketed placeholders for facts you were not given.
CONTEXT:
`;

export function buildLlmUserMessage(plan: DailyPlan, data: AgentData): string {
  return `${RULES}${JSON.stringify(buildLlmContext(plan, data))}`;
}

const FAILURE_MESSAGE: Record<LlmFailure | 'invalid', string> = {
  not_configured: 'AI drafting is not configured on this server (ANTHROPIC_API_KEY is missing). Showing rule-based recommendations from your data.',
  timeout: 'The AI service timed out. Showing rule-based recommendations; nothing was drafted.',
  network: 'The AI service could not be reached. Showing rule-based recommendations; nothing was drafted.',
  http_error: 'The AI service returned an error. Showing rule-based recommendations; nothing was drafted.',
  empty: 'The AI service returned an empty answer. Showing rule-based recommendations; nothing was drafted.',
  bad_json: 'The AI answer was not valid JSON, so it was rejected. Showing rule-based recommendations; nothing was drafted.',
  invalid: 'The AI answer failed validation and was rejected, not shown. Showing rule-based recommendations; nothing was drafted.',
};

function toRecommendation(c: Candidate): Recommendation {
  return { key: c.key, pillar: c.pillar as Pillar, action: c.action, reason: c.reason, source_record_ids: c.source_record_ids, href: c.href };
}

function rulesOnly(plan: DailyPlan, status: DailyStatus, fallback?: DailyAnalysis['fallback']): DailyAnalysis {
  return {
    status,
    source: 'rules',
    flags: plan.flags,
    recommendations: plan.top.map(toRecommendation),
    draft: null,
    learning: plan.feedback.notes,
    message: null,
    fallback,
  };
}

/**
 * DRAFT step. Deterministic findings go to the model for wording and one drafted asset.
 * Anything invalid, incomplete, unsupported or unsafe is rejected and replaced by the
 * rule-based result with an explicit fallback message.
 */
export async function analyzeDaily(
  plan: DailyPlan,
  data: AgentData,
  callLlm: LlmCall,
): Promise<DailyAnalysis> {
  if (plan.flags.length === 0) {
    return {
      status: plan.hasRecords ? 'clear' : 'no_data',
      source: 'rules',
      flags: [],
      recommendations: [],
      draft: null,
      learning: plan.feedback.notes,
      message: plan.hasRecords
        ? 'All checks passed. Nothing needs your attention right now.'
        : 'No records yet. Add an idea, post, deal or invoice so PBOS has something to scan.',
    };
  }

  if (plan.top.length === 0) {
    return {
      ...rulesOnly(plan, 'clear'),
      message: 'Every open suggestion is paused by your recent feedback. Flags are still listed below.',
    };
  }

  const llm = await callLlm({
    staticSystem: staticSystemBlock(data.profile),
    user: buildLlmUserMessage(plan, data),
    maxTokens: 1800,
  });

  if (!llm.ok) {
    return rulesOnly(plan, 'fallback', {
      reason: llm.reason,
      message: FAILURE_MESSAGE[llm.reason],
      details: llm.detail ? [llm.detail] : undefined,
    });
  }

  const allowedNumbers = collectNumbers(buildLlmContext(plan, data));
  collectNumbers(staticProfileContext(data.profile), allowedNumbers);

  const checked = validateDaily(llm.json, {
    allowedIds: plan.allowedIds,
    flags: plan.flags,
    candidates: plan.top,
    allowedNumbers,
    draftIntent: plan.draftIntent,
  });

  if (!checked.ok) {
    return rulesOnly(plan, 'fallback', {
      reason: 'invalid_output',
      message: FAILURE_MESSAGE.invalid,
      details: checked.reasons,
    });
  }

  const candidateByKey = new Map(plan.top.map((c) => [c.key, c]));
  return {
    status: 'ok',
    source: 'llm',
    flags: plan.flags.map((f) => {
      const written = checked.value.flags.find((x) => x.key === f.key);
      return written ? { ...f, message: written.message } : f;
    }),
    recommendations: checked.value.recommendations.map((r) => ({
      key: r.key,
      pillar: r.pillar,
      action: r.action,
      reason: r.reason,
      source_record_ids: candidateByKey.get(r.key)?.source_record_ids ?? r.source_record_ids,
      href: candidateByKey.get(r.key)?.href ?? '/dashboard',
    })),
    draft: checked.value.draft,
    learning: plan.feedback.notes,
    message: null,
  };
}
