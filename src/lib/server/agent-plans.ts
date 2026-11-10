import 'server-only';
import { cleanEditPlan, cleanVideoPlan, isPlanId, type EditPlan, type HandoffTool, type VideoPlan } from '@/lib/agent/handoff';
import { loadAction } from './agent-log';
import type { ServerSupabase } from '@/lib/supabase/server';

/**
 * Reads a plan the agent prepared, for the Video page and the Studio. The link carries only the id of the agent's own
 * activity row. The row is read with the creator's session and an explicit creator filter, must be the right tool and
 * not undone, and its stored arguments are checked again, because a stored row is only data.
 */
async function loadPlanArgs(supabase: ServerSupabase, creatorId: string, planId: string | undefined, tool: HandoffTool): Promise<unknown | null> {
  if (!isPlanId(planId)) return null;
  const { row } = await loadAction(supabase, creatorId, planId);
  if (!row || row.tool !== tool || row.tier !== 'create' || row.status !== 'done') return null;
  return row.args;
}

export async function loadVideoPlan(supabase: ServerSupabase, creatorId: string, planId: string | undefined): Promise<VideoPlan | null> {
  const args = await loadPlanArgs(supabase, creatorId, planId, 'plan_video');
  if (!args) return null;
  const plan = cleanVideoPlan(args);
  return plan.ok ? plan.value : null;
}

export async function loadEditPlan(supabase: ServerSupabase, creatorId: string, planId: string | undefined): Promise<EditPlan | null> {
  const args = await loadPlanArgs(supabase, creatorId, planId, 'plan_edit');
  if (!args) return null;
  const plan = cleanEditPlan(args);
  return plan.ok ? plan.value : null;
}
