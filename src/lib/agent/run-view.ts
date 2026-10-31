import { PILLARS, type Pillar } from '../constants';
import type { AgentEvent } from '../types';
import type { DailyPlan } from './daily';
import type { Candidate, DraftType, Flag } from './types';

/** What the dashboard shows: the stored run, reconciled against the live data. */

export type StoredSuggestion = {
  event_id: string;
  key: string;
  pillar: Pillar;
  action: string;
  reason: string;
  source_record_ids: string[];
  href: string;
  decision: 'accepted' | 'ignored' | null;
};

export type StoredDraft = {
  event_id: string;
  key: string;
  type: DraftType;
  platform: string;
  content: string;
  source_record_ids: string[];
};

export type StoredRun = {
  run_id: string;
  at: string;
  source: 'llm' | 'rules';
  flags: Array<{ event_id: string; key: string; pillar: Pillar; message: string; source_record_ids: string[] }>;
  suggestions: StoredSuggestion[];
  draft: StoredDraft | null;
};

const isPillar = (v: unknown): v is Pillar => typeof v === 'string' && (PILLARS as readonly string[]).includes(v);
const asStr = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asIds = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The most recent daily-loop run found in agent_events, with each suggestion's accept/ignore decision. */
export function latestRun(events: AgentEvent[]): StoredRun | null {
  const runEvents = events.filter(
    (e) => (e.type === 'flag' || e.type === 'suggestion' || e.type === 'draft') && typeof e.payload?.run_id === 'string',
  );
  if (runEvents.length === 0) return null;

  const newestAt = new Map<string, number>();
  for (const e of runEvents) {
    const rid = e.payload.run_id as string;
    newestAt.set(rid, Math.max(newestAt.get(rid) ?? 0, new Date(e.created_at).getTime()));
  }
  const runId = Array.from(newestAt.entries()).sort((a, b) => b[1] - a[1])[0][0];
  const mine = runEvents.filter((e) => e.payload.run_id === runId);

  const decisions = new Map<string, 'accepted' | 'ignored'>();
  for (const e of events) {
    if ((e.type === 'accepted' || e.type === 'ignored') && typeof e.payload?.suggestion_event_id === 'string') {
      const id = e.payload.suggestion_event_id;
      if (!decisions.has(id)) decisions.set(id, e.type); // events are newest-first; keep the latest decision
    }
  }

  const run: StoredRun = {
    run_id: runId,
    at: new Date(newestAt.get(runId) as number).toISOString(),
    source: mine.some((e) => e.payload.source === 'llm') ? 'llm' : 'rules',
    flags: [],
    suggestions: [],
    draft: null,
  };

  for (const e of mine) {
    if (!isPillar(e.pillar)) continue;
    if (e.type === 'flag') {
      run.flags.push({ event_id: e.id, key: asStr(e.payload.key), pillar: e.pillar, message: asStr(e.payload.message), source_record_ids: e.source_record_ids });
    } else if (e.type === 'suggestion') {
      run.suggestions.push({
        event_id: e.id,
        key: asStr(e.payload.key),
        pillar: e.pillar,
        action: asStr(e.payload.action),
        reason: asStr(e.payload.reason),
        source_record_ids: asIds(e.source_record_ids),
        href: asStr(e.payload.href, '/dashboard'),
        decision: decisions.get(e.id) ?? null,
      });
    } else if (e.type === 'draft') {
      run.draft = {
        event_id: e.id,
        key: asStr(e.payload.key),
        type: asStr(e.payload.draft_type, 'caption') as DraftType,
        platform: asStr(e.payload.platform),
        content: asStr(e.payload.content),
        source_record_ids: asIds(e.source_record_ids),
      };
    }
  }
  return run;
}

export type DashboardView = {
  flags: Flag[];
  suggestions: StoredSuggestion[];
  draft: StoredDraft | null;
  /** Stored suggestions whose condition no longer holds in the data. */
  resolved: number;
  /** Live findings the stored run does not cover yet. */
  newFindings: Candidate[];
  runAt: string | null;
  stale: boolean;
};

export const RUN_STALE_HOURS = 24;

/**
 * Reconcile the stored run with the live data so the dashboard never shows a finding that
 * is no longer true, and says so when the data has moved on since the last run.
 */
export function composeDashboard(run: StoredRun | null, plan: DailyPlan, now: Date): DashboardView {
  const liveKeys = new Set(plan.flags.map((f) => f.key));
  const storedFlagMessage = new Map((run?.flags ?? []).map((f) => [f.key, f.message]));
  const flags = plan.flags.map((f) => ({ ...f, message: storedFlagMessage.get(f.key) ?? f.message }));

  const suggestions = (run?.suggestions ?? []).filter((s) => liveKeys.has(s.key));
  const resolved = (run?.suggestions.length ?? 0) - suggestions.length;
  const shownKeys = new Set(suggestions.map((s) => s.key));
  const newFindings = plan.top.filter((c) => !shownKeys.has(c.key));

  const draft = run?.draft && liveKeys.has(run.draft.key) ? run.draft : null;
  const stale = !run || now.getTime() - new Date(run.at).getTime() > RUN_STALE_HOURS * 3_600_000;

  return { flags, suggestions, draft, resolved, newFindings, runAt: run?.at ?? null, stale };
}
