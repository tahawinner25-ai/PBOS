'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { toolByName } from '@/lib/agent/tools/specs';
import { collectNumbers } from '@/lib/agent/validate';
import { applyChange, undoCreated } from '@/lib/server/agent-exec';
import { loadAction } from '@/lib/server/agent-log';
import { confirmChange } from '@/lib/agent/verify';
import { rateLimit } from '@/lib/server/rate-limit';
import type { ActionResult } from '@/lib/types';

/**
 * The creator's three buttons on the agent's activity feed. This is the only code that runs an agent-proposed
 * change, and it runs it from the stored row (never from anything the browser sends except the row id):
 *
 *   Approve  claims the row (pending -> approved, once), re-validates the stored arguments, applies the change,
 *            and records the outcome. A second click finds the row already decided and does nothing.
 *   Dismiss  marks it dismissed; nothing changes.
 *   Undo     removes a record the agent created, unless the creator has built on it since.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const touch = () => revalidatePath('/agent');
const cut = (s: string) => s.slice(0, 300);

export async function approveAgentAction(id: string): Promise<ActionResult> {
  return withCreator(async (ctx) => {
    const { supabase, profile } = ctx;
    if (typeof id !== 'string' || !UUID.test(id)) return fail('That request was not found.');
    if (!rateLimit(`agent-decide:${profile.id}`, 40, 60_000).allowed) return fail('Too many decisions in a minute. Wait a moment.');

    const { row, failed } = await loadAction(supabase, profile.id, id);
    if (failed) return fail('Could not read that request. Try again in a moment.');
    if (!row) return fail('That request was not found.');
    if (row.tier !== 'change') return fail('Only requests waiting for approval can be approved.');
    if (row.status !== 'pending') return fail(row.status === 'approved' ? 'This was already approved.' : row.status === 'dismissed' ? 'You already dismissed this request.' : 'This request can no longer be approved.');

    const spec = toolByName(row.tool);
    if (!spec || spec.tier !== 'change') return fail('This kind of request is not supported.');
    // The arguments were checked when the agent asked. They are checked again because the row is only data. The
    // numbers in a metrics request were already matched to the creator's own words then; the card showed them.
    const own = collectNumbers(row.args);
    const parsed = spec.parse(row.args, { now: new Date(), userNumbers: own, allowedNumbers: own });
    if (!parsed.ok) {
      await supabase.from('agent_actions').update({ status: 'failed', result: { error: cut(parsed.error) } }).eq('id', row.id).eq('creator_id', profile.id).eq('status', 'pending');
      touch();
      return fail('This request was not valid any more, so it was not applied. Ask the agent again.');
    }

    // Claim first, so a double click or a second tab cannot apply the same change twice.
    const claimed = await supabase.from('agent_actions').update({ status: 'approved', decided_at: new Date().toISOString() }).eq('id', row.id).eq('creator_id', profile.id).eq('status', 'pending').select('id');
    if (claimed.error) return dbFail('approveAgentAction.claim', claimed.error);
    if (!claimed.data?.length) return fail('This request was already decided.');

    const outcome = await applyChange(ctx, row.tool, parsed.value);
    if (!outcome.ok) {
      await supabase.from('agent_actions').update({ status: 'failed', result: { error: cut(outcome.error) } }).eq('id', row.id).eq('creator_id', profile.id).eq('status', 'approved');
      touch();
      return fail(outcome.error);
    }
    // VERIFY: read the changed field back and compare it with what was approved before saying it worked.
    const confirmed = await confirmChange(supabase as never, profile.id, row.tool, parsed.value as Record<string, unknown>);
    if (!confirmed.ok) {
      const error = `It was applied, but the result could not be confirmed (${confirmed.reason}). Check the page before relying on it.`;
      await supabase.from('agent_actions').update({ status: 'failed', result: { error: cut(error) } }).eq('id', row.id).eq('creator_id', profile.id).eq('status', 'approved');
      touch();
      return fail(error);
    }
    await supabase.from('agent_actions').update({ result: { message: cut(outcome.message), verified: true } }).eq('id', row.id).eq('creator_id', profile.id);
    touch();
    return ok(outcome.message);
  });
}

export async function dismissAgentAction(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (typeof id !== 'string' || !UUID.test(id)) return fail('That request was not found.');
    const { data, error } = await supabase.from('agent_actions').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', id).eq('creator_id', profile.id).eq('tier', 'change').eq('status', 'pending').select('id');
    if (error) return dbFail('dismissAgentAction', error);
    if (!data?.length) return fail('This request was already decided, or no longer exists.');
    touch();
    return ok('Dismissed. Nothing was changed.');
  });
}

export async function undoAgentAction(id: string): Promise<ActionResult> {
  return withCreator(async (ctx) => {
    const { supabase, profile } = ctx;
    if (typeof id !== 'string' || !UUID.test(id)) return fail('That item was not found.');
    if (!rateLimit(`agent-decide:${profile.id}`, 40, 60_000).allowed) return fail('Too many decisions in a minute. Wait a moment.');

    const { row, failed } = await loadAction(supabase, profile.id, id);
    if (failed) return fail('Could not read that item. Try again in a moment.');
    if (!row) return fail('That item was not found.');
    if (row.tier !== 'create' || row.status !== 'done') return fail(row.status === 'undone' ? 'This was already undone.' : 'Only items the agent created can be undone.');

    const outcome = await undoCreated(ctx, row);
    if (!outcome.ok) return fail(outcome.error);
    // Idempotent on purpose: if the record was already gone, the row still ends up marked undone.
    const up = await supabase.from('agent_actions').update({ status: 'undone', decided_at: new Date().toISOString() }).eq('id', row.id).eq('creator_id', profile.id).eq('status', 'done');
    if (up.error) return dbFail('undoAgentAction.settle', up.error);
    touch();
    return ok(outcome.message);
  });
}
