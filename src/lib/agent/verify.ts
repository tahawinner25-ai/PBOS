import type { RecordRef } from '@/lib/agent/runner';

/**
 * The VERIFY step of the agent loop. A create tool reports "I made record X". The model must never be the one
 * to vouch for that, and neither should the tool's own return value: before the agent may say anything was saved,
 * the server reads the row back, with the creator filter, and checks it is really there and holds what was
 * asked for. If it is not, the tool call becomes a failure the agent has to report honestly.
 */

type Spec = { table: string; columns: string; check?: (row: Record<string, unknown>) => string | null };

const filled = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

const SPECS: Record<string, Spec> = {
  idea: { table: 'ideas', columns: 'id, hook' },
  idea_script: { table: 'ideas', columns: 'id, script', check: (r) => (filled(r.script) ? null : 'the script is empty') },
  idea_variants: { table: 'ideas', columns: 'id, hook_variants', check: (r) => (Array.isArray(r.hook_variants) && r.hook_variants.length > 0 ? null : 'the variants are missing') },
  post: { table: 'posts', columns: 'id' },
  publish_job: { table: 'publish_jobs', columns: 'id, status', check: (r) => (r.status === 'draft' ? null : 'the draft is not in draft status') },
  media: { table: 'media_assets', columns: 'id, kind' },
  ad: { table: 'ad_creatives', columns: 'id, status', check: (r) => (r.status === 'draft' ? null : 'the ad is not a draft') },
};

/** The slice of the Supabase query builder this needs, so tests can use a plain fake. */
export type ReadBack = {
  from(table: string): {
    select(columns: string): { eq(column: string, value: string): { eq(column: string, value: string): { maybeSingle(): PromiseLike<{ data: unknown; error: { code?: string } | null }> } } };
  };
};

export type Verdict = { ok: true } | { ok: false; reason: string };

export async function verifyRecord(db: ReadBack, creatorId: string, record: Pick<RecordRef, 'kind' | 'id'>): Promise<Verdict> {
  const spec = SPECS[record.kind];
  // A kind this file does not know cannot be confirmed, and is never reported as confirmed.
  if (!spec) return { ok: false, reason: 'this kind of record cannot be checked' };
  try {
    const { data, error } = await db.from(spec.table).select(spec.columns).eq('id', record.id).eq('creator_id', creatorId).maybeSingle();
    if (error) return { ok: false, reason: 'the database could not be read' };
    if (!data) return { ok: false, reason: 'no matching row was found' };
    const problem = spec.check?.(data as Record<string, unknown>) ?? null;
    return problem ? { ok: false, reason: problem } : { ok: true };
  } catch {
    return { ok: false, reason: 'the check could not run' };
  }
}

/** Kinds this file can confirm. The test suite asserts every create tool's kind is in here. */
export const VERIFIABLE_KINDS = Object.keys(SPECS);

/**
 * The same read-back for an approved change. After the executor says "applied", the field the change was meant to
 * set is read and compared with what was approved. A mismatch means the creator is told the truth: it did not take.
 */
type ChangeCheck = { table: string; id: string; column: string; expected: string; label: string };

export function changeCheckFor(tool: string, args: Record<string, unknown>): ChangeCheck | null {
  const text = (v: unknown) => (typeof v === 'string' ? v : null);
  switch (tool) {
    case 'move_deal': { const id = text(args.deal_id), v = text(args.stage); return id && v ? { table: 'deals', id, column: 'stage', expected: v, label: 'the deal stage' } : null; }
    case 'set_invoice_status': { const id = text(args.invoice_id), v = text(args.status); return id && v ? { table: 'revenue_entries', id, column: 'status', expected: v, label: 'the invoice status' } : null; }
    case 'set_idea_status': { const id = text(args.idea_id), v = text(args.status); return id && v ? { table: 'ideas', id, column: 'status', expected: v, label: 'the idea status' } : null; }
    case 'schedule_idea': { const id = text(args.idea_id), v = text(args.date); return id && v ? { table: 'ideas', id, column: 'scheduled_for', expected: v, label: 'the scheduled date' } : null; }
    default: return null; // log_metrics writes only the fields the creator gave, so there is no single value to compare.
  }
}

export async function confirmChange(db: ReadBack, creatorId: string, tool: string, args: Record<string, unknown>): Promise<Verdict> {
  const check = changeCheckFor(tool, args);
  if (!check) return { ok: true };
  try {
    const { data, error } = await db.from(check.table).select(`id, ${check.column}`).eq('id', check.id).eq('creator_id', creatorId).maybeSingle();
    if (error) return { ok: false, reason: 'the database could not be read' };
    if (!data) return { ok: false, reason: 'the record was not found' };
    const actual = (data as Record<string, unknown>)[check.column];
    // Dates come back as plain YYYY-MM-DD, or as a timestamp that starts with it.
    const matches = typeof actual === 'string' && (actual === check.expected || actual.startsWith(`${check.expected}T`));
    return matches ? { ok: true } : { ok: false, reason: `${check.label} is not ${check.expected}` };
  } catch {
    return { ok: false, reason: 'the check could not run' };
  }
}
