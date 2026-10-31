'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { buildDemoRows } from '@/lib/demo';
import type { ActionResult } from '@/lib/types';
import { rules } from '@/lib/validation';

/**
 * LEARN step: record whether the creator accepted or ignored a suggestion. Accepting never
 * performs the action (the creator does that themselves); it only records the decision.
 */
export async function respondToSuggestion(eventId: string, decision: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(eventId, 'Suggestion');
    if (!idRes.ok) return fail(idRes.error);
    const decisionRes = rules.oneOf(['accepted', 'ignored'] as const)(decision, 'Decision');
    if (!decisionRes.ok) return fail(decisionRes.error);

    const { data, error } = await supabase
      .from('agent_events')
      .select('id, type, pillar, payload, source_record_ids')
      .eq('id', idRes.value)
      .eq('creator_id', profile.id)
      .maybeSingle();
    if (error) return dbFail('respondToSuggestion read', error);
    const suggestion = data as { id: string; type: string; pillar: string | null; payload: Record<string, unknown>; source_record_ids: string[] } | null;
    if (!suggestion || suggestion.type !== 'suggestion') return fail('That suggestion no longer exists.');

    const { data: existing, error: existingError } = await supabase
      .from('agent_events')
      .select('id')
      .eq('creator_id', profile.id)
      .in('type', ['accepted', 'ignored'])
      .eq('payload->>suggestion_event_id', suggestion.id)
      .limit(1);
    if (existingError) return dbFail('respondToSuggestion existing', existingError);
    if (existing && existing.length > 0) return fail('You already responded to this suggestion.');

    const { error: insertError } = await supabase.from('agent_events').insert({
      creator_id: profile.id,
      type: decisionRes.value,
      pillar: suggestion.pillar,
      payload: {
        suggestion_event_id: suggestion.id,
        key: suggestion.payload.key,
        action: suggestion.payload.action,
        decision: decisionRes.value,
      },
      source_record_ids: suggestion.source_record_ids,
    });
    if (insertError) return dbFail('respondToSuggestion insert', insertError);
    revalidatePath('/dashboard');
    return ok(decisionRes.value === 'accepted' ? 'Accepted. PBOS will give it a couple of days before raising it again.' : 'Ignored. PBOS will pause this suggestion if you ignore it again.');
  });
}

/** Demo data, always flagged is_demo so it is labelled in the UI and never shown on the public media kit. */
export async function seedDemoData(): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const { count, error: countError } = await supabase.from('ideas').select('id', { count: 'exact', head: true }).eq('creator_id', profile.id).eq('is_demo', true);
    if (countError) return dbFail('seedDemoData count', countError);
    if ((count ?? 0) > 0) return fail('Demo data is already loaded. Remove it first to reload.');

    const rows = buildDemoRows(profile.id, new Date());
    for (const table of ['ideas', 'deals', 'posts', 'revenue_entries'] as const) {
      const { error } = await supabase.from(table).insert(rows[table]);
      if (error) {
        // Roll back whatever was inserted so a half-loaded demo never lingers.
        for (const t of ['revenue_entries', 'posts', 'deals', 'ideas'] as const) {
          await supabase.from(t).delete().eq('creator_id', profile.id).eq('is_demo', true);
        }
        return dbFail(`seedDemoData ${table}`, error);
      }
    }
    ['/dashboard', '/ideas', '/analytics', '/deals', '/revenue', '/settings'].forEach((p) => revalidatePath(p));
    return ok('Demo data loaded. Every demo row is labelled “Demo” and is never shown on your public media kit.');
  });
}

export async function clearDemoData(): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    for (const table of ['revenue_entries', 'posts', 'deals', 'ideas'] as const) {
      const { error } = await supabase.from(table).delete().eq('creator_id', profile.id).eq('is_demo', true);
      if (error) return dbFail(`clearDemoData ${table}`, error);
    }
    ['/dashboard', '/ideas', '/analytics', '/deals', '/revenue', '/settings', '/work-with-me'].forEach((p) => revalidatePath(p));
    return ok('Demo data removed. Refresh the daily loop to clear old suggestions.');
  });
}
