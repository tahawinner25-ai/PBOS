import 'server-only';
import type { ActionRow } from '@/lib/agent/activity';
import type { ActionStore, NewAction } from '@/lib/agent/runner';
import type { ServerSupabase } from '@/lib/supabase/server';

/**
 * The agent's action log (table agent_actions, migration 0007). Written with the creator's own session, so
 * row-level security is what keeps one creator's log from another's.
 */

export const ACTION_COLUMNS = 'id, run_id, tool, tier, status, summary, args, result, created_at, decided_at';

export function createActionStore(supabase: ServerSupabase, creatorId: string): ActionStore {
  return {
    async record(a: NewAction): Promise<string | null> {
      const { data, error } = await supabase
        .from('agent_actions')
        .insert({ creator_id: creatorId, run_id: a.runId, tool: a.tool, tier: a.tier, status: a.status, summary: a.summary.slice(0, 400), args: a.args, result: a.result })
        .select('id')
        .single();
      if (error) {
        console.error('[agent-log] could not record action:', error.code, error.message);
        return null;
      }
      return (data as { id: string }).id;
    },
  };
}

/** Newest first. Only this creator's rows: the filter is explicit, and RLS enforces it underneath. */
export async function loadActions(supabase: ServerSupabase, creatorId: string, limit = 40): Promise<ActionRow[]> {
  const { data, error } = await supabase.from('agent_actions').select(ACTION_COLUMNS).eq('creator_id', creatorId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw new Error(`agent_actions: ${error.message}`);
  return (data ?? []) as ActionRow[];
}

export async function loadAction(supabase: ServerSupabase, creatorId: string, id: string): Promise<{ row: ActionRow | null; failed: boolean }> {
  const { data, error } = await supabase.from('agent_actions').select(ACTION_COLUMNS).eq('id', id).eq('creator_id', creatorId).maybeSingle();
  if (error) {
    console.error('[agent-log] load failed:', error.code, error.message);
    return { row: null, failed: true };
  }
  return { row: (data as ActionRow | null) ?? null, failed: false };
}
