import type { ActionView, DraftOut, RecordRef } from './runner';
import { toolByName } from './tools/specs';

/**
 * The activity feed: how a stored agent_actions row is shown to the creator. Pure, so the rules for what can be
 * undone, approved or copied are tested without a database.
 */

export type ActionRow = {
  id: string;
  run_id: string;
  tool: string;
  tier: 'create' | 'change';
  status: 'done' | 'pending' | 'approved' | 'dismissed' | 'failed' | 'undone';
  summary: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  created_at: string;
  decided_at: string | null;
};

export type FeedItem = {
  id: string;
  runId: string;
  tool: string;
  tier: 'create' | 'change';
  status: ActionRow['status'];
  summary: string;
  href: string;
  createdAt: string;
  decidedAt: string | null;
  canApprove: boolean;
  canUndo: boolean;
  record?: RecordRef;
  draft?: DraftOut;
  error?: string;
  note?: string;
  /** The server confirmed the made record exists in the creator's workspace. */
  verified?: boolean;
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Pointer to the made record, if the row has a well-formed one. Links stay inside the app. */
export function recordOf(row: Pick<ActionRow, 'result'>): RecordRef | undefined {
  const r = row.result;
  const kind = str(r.kind, 40);
  const id = str(r.id, 60);
  const href = str(r.href, 60);
  if (!kind || !id || !/^\/[a-z-]+$/.test(href)) return undefined;
  return { kind, id, href };
}

/** A written draft lives in the row's own arguments, so it can be shown and copied again after a reload. */
export function draftOf(row: Pick<ActionRow, 'tool' | 'args' | 'status'>): DraftOut | undefined {
  if (row.tool !== 'write_draft' || row.status === 'undone') return undefined;
  const { kind, title, body } = row.args;
  if (typeof body !== 'string' || typeof title !== 'string') return undefined;
  return { kind: str(kind, 20) || 'note', title: str(title, 120), body: str(body, 3000) };
}

export function toFeedItem(row: ActionRow): FeedItem {
  const spec = toolByName(row.tool);
  const record = recordOf(row);
  const error = row.status === 'failed' && typeof row.result.error === 'string' ? str(row.result.error, 300) : undefined;
  const note = typeof row.result.message === 'string' ? str(row.result.message, 300) : undefined;
  return {
    id: row.id,
    runId: row.run_id,
    tool: row.tool,
    tier: row.tier,
    status: row.status,
    summary: row.summary,
    href: record?.href ?? spec?.href ?? '/agent',
    createdAt: row.created_at,
    decidedAt: row.decided_at,
    canApprove: row.tier === 'change' && row.status === 'pending' && !!spec && spec.tier === 'change',
    canUndo: row.tier === 'create' && row.status === 'done' && !!spec && spec.tier === 'create',
    record,
    draft: draftOf(row),
    error,
    note,
    verified: (row.status === 'done' || row.status === 'approved') && row.result.verified === true ? true : undefined,
  };
}

/** The same shape for what a run returns right now, so one component renders both. An entry the log could not store has no id and no buttons. */
export function viewToFeedItem(v: ActionView, runId: string, now: string, index: number): FeedItem {
  const spec = toolByName(v.tool);
  const stored = v.id !== null;
  return {
    id: v.id ?? `local-${index}`, runId, tool: v.tool, tier: v.tier, status: v.status, summary: v.summary, href: v.href, createdAt: now, decidedAt: null,
    canApprove: stored && v.tier === 'change' && v.status === 'pending' && !!spec, canUndo: stored && v.tier === 'create' && v.status === 'done', record: v.record, draft: v.draft, error: v.error, verified: v.verified,
  };
}
