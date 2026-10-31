import 'server-only';
import type { DailyAnalysis } from '@/lib/agent/daily';
import type { Pillar } from '@/lib/constants';
import type { ServerSupabase } from '@/lib/supabase/server';

const DRAFT_PILLAR: Record<string, Pillar> = {
  invoices_overdue: 'Revenue',
  deals_stale: 'Deals',
  format_followup: 'Ideation',
  ideas_stale: 'Ideation',
};

export type PersistedIds = {
  flags: Record<string, string>;
  suggestions: Record<string, string>;
  draft: string | null;
};

/** Save a run's flags, suggestions and draft to agent_events. Throws on database failure. */
export async function persistRun(
  supabase: ServerSupabase,
  creatorId: string,
  runId: string,
  analysis: DailyAnalysis,
): Promise<PersistedIds> {
  const source = analysis.source;
  const rows: Array<Record<string, unknown>> = [];

  for (const f of analysis.flags) {
    rows.push({
      creator_id: creatorId,
      type: 'flag',
      pillar: f.pillar,
      payload: { run_id: runId, key: f.key, message: f.message, source },
      source_record_ids: f.source_record_ids,
    });
  }
  for (const r of analysis.recommendations) {
    rows.push({
      creator_id: creatorId,
      type: 'suggestion',
      pillar: r.pillar,
      payload: { run_id: runId, key: r.key, action: r.action, reason: r.reason, href: r.href, source },
      source_record_ids: r.source_record_ids,
    });
  }
  if (analysis.draft) {
    rows.push({
      creator_id: creatorId,
      type: 'draft',
      pillar: DRAFT_PILLAR[analysis.draft.key] ?? 'Ideation',
      payload: {
        run_id: runId,
        key: analysis.draft.key,
        draft_type: analysis.draft.type,
        platform: analysis.draft.platform,
        content: analysis.draft.content,
        source,
      },
      source_record_ids: analysis.draft.source_record_ids,
    });
  }

  const ids: PersistedIds = { flags: {}, suggestions: {}, draft: null };
  if (rows.length === 0) return ids;

  const { data, error } = await supabase.from('agent_events').insert(rows).select('id, type, payload');
  if (error) throw new Error(`agent_events insert failed: ${error.message}`);

  for (const row of (data ?? []) as Array<{ id: string; type: string; payload: Record<string, unknown> }>) {
    const key = typeof row.payload?.key === 'string' ? row.payload.key : '';
    if (row.type === 'flag') ids.flags[key] = row.id;
    else if (row.type === 'suggestion') ids.suggestions[key] = row.id;
    else if (row.type === 'draft') ids.draft = row.id;
  }
  return ids;
}
