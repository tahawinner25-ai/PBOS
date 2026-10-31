'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { CONTENT_MIX, FORMATS, IDEA_STATUSES, PLATFORMS, type IdeaStatus } from '@/lib/constants';
import { truncate } from '@/lib/format';
import { hasAnyMetric } from '@/lib/metrics';
import { isNearDuplicate, jaccard } from '@/lib/similarity';
import type { ServerSupabase } from '@/lib/supabase/server';
import type { ActionResult, HookVariant, Idea, Post } from '@/lib/types';
import { parse, rules } from '@/lib/validation';

const touch = () => ['/ideas', '/dashboard', '/analytics'].forEach((p) => revalidatePath(p));

function checkVariants(v: unknown): HookVariant[] | null {
  if (!Array.isArray(v) || v.length > 3) return null;
  const out: HookVariant[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') return null;
    const { angle, hook } = item as Record<string, unknown>;
    if (typeof angle !== 'string' || typeof hook !== 'string') return null;
    if (!hook.trim() || hook.length > 200 || angle.length > 60) return null;
    out.push({ angle: angle.trim(), hook: hook.trim() });
  }
  return out;
}

/** Lazy duplication guard: a near-identical hook must become a genuinely different idea. */
async function findLookalike(supabase: ServerSupabase, creatorId: string, hook: string, excludeId?: string) {
  const { data, error } = await supabase.from('ideas').select('id, hook, platform').eq('creator_id', creatorId).limit(500);
  if (error) return { error, match: null };
  const match = ((data ?? []) as Pick<Idea, 'id' | 'hook' | 'platform'>[]).find(
    (row) => row.id !== excludeId && row.hook && isNearDuplicate(hook, row.hook),
  );
  return { error: null, match: match ?? null };
}

function lookalikeMessage(match: Pick<Idea, 'hook' | 'platform'>, platform: string) {
  const other = match.platform ?? 'another platform';
  if (match.platform === platform) {
    return `This is nearly the same as an idea already in your bank (“${truncate(match.hook, 60)}”). Edit that one instead of adding a copy.`;
  }
  return `This is nearly identical to your idea for ${other} (“${truncate(match.hook, 60)}”). Use “Adapt for another platform” and write a platform-specific angle so each platform gets its own take.`;
}

const ideaFields = {
  platform: rules.oneOf(PLATFORMS),
  format: rules.oneOf(FORMATS),
  hook: rules.text({ min: 5, max: 280 }),
  content_mix: rules.optionalOneOf(CONTENT_MIX),
  scheduled_for: rules.optionalDate(),
};
const ideaLabels = { hook: 'Hook', content_mix: 'Content mix', scheduled_for: 'Scheduled date' };

export async function createIdea(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return withCreator<{ id: string }>(async ({ supabase, profile }) => {
    const parsed = parse(formData, { ...ideaFields, hook_variants: rules.json<HookVariant[]>(checkVariants, []) }, ideaLabels);
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;

    const dup = await findLookalike(supabase, profile.id, d.hook);
    if (dup.error) return dbFail('createIdea lookalike', dup.error);
    if (dup.match) {
      const message = lookalikeMessage(dup.match, d.platform);
      return fail(message, { hook: message });
    }

    const { data: row, error } = await supabase.from('ideas').insert({
      creator_id: profile.id,
      platform: d.platform,
      format: d.format,
      hook: d.hook,
      hook_variants: d.hook_variants,
      content_mix: d.content_mix,
      scheduled_for: d.scheduled_for,
      status: d.scheduled_for ? 'scheduled' : 'idea',
    }).select('id').single();
    if (error) return dbFail('createIdea', error);
    touch();
    return { ok: true, message: d.scheduled_for ? 'Idea added and scheduled.' : 'Idea added to the bank.', data: { id: (row as { id: string }).id } };
  });
}

export async function updateIdea(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(formData, { id: rules.uuid(), ...ideaFields, script: rules.optionalText({ max: 5000 }) }, { ...ideaLabels, id: 'Idea' });
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;

    const { data: current, error: readError } = await supabase.from('ideas').select('*').eq('id', d.id).eq('creator_id', profile.id).maybeSingle();
    if (readError) return dbFail('updateIdea read', readError);
    if (!current) return fail('That idea no longer exists.');
    const idea = current as Idea;

    if (idea.hook !== d.hook) {
      const dup = await findLookalike(supabase, profile.id, d.hook, d.id);
      if (dup.error) return dbFail('updateIdea lookalike', dup.error);
      if (dup.match) {
        const message = lookalikeMessage(dup.match, d.platform);
        return fail(message, { hook: message });
      }
    }

    let status: IdeaStatus = idea.status;
    if (d.scheduled_for && (status === 'idea' || status === 'scripted')) status = 'scheduled';
    else if (d.script && status === 'idea') status = 'scripted';

    const { error } = await supabase
      .from('ideas')
      .update({ platform: d.platform, format: d.format, hook: d.hook, content_mix: d.content_mix, scheduled_for: d.scheduled_for, script: d.script, status })
      .eq('id', d.id)
      .eq('creator_id', profile.id);
    if (error) return dbFail('updateIdea', error);
    touch();
    return ok('Idea updated.');
  });
}

export async function deleteIdea(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const v = rules.uuid()(id, 'Idea');
    if (!v.ok) return fail(v.error);
    const { error } = await supabase.from('ideas').delete().eq('id', v.value).eq('creator_id', profile.id);
    if (error) return dbFail('deleteIdea', error);
    touch();
    return ok('Idea deleted.');
  });
}

export async function setIdeaStatus(id: string, status: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(id, 'Idea');
    if (!idRes.ok) return fail(idRes.error);
    const statusRes = rules.oneOf(IDEA_STATUSES)(status, 'Status');
    if (!statusRes.ok) return fail(statusRes.error);
    const next = statusRes.value;

    const { data, error: readError } = await supabase.from('ideas').select('*').eq('id', idRes.value).eq('creator_id', profile.id).maybeSingle();
    if (readError) return dbFail('setIdeaStatus read', readError);
    if (!data) return fail('That idea no longer exists.');
    const idea = data as Idea;

    const { data: postRows, error: postError } = await supabase.from('posts').select('*').eq('idea_id', idea.id).eq('creator_id', profile.id);
    if (postError) return dbFail('setIdeaStatus posts', postError);
    const posts = (postRows ?? []) as Post[];

    let message = `Moved to ${next}.`;
    if (next === 'posted' && posts.length === 0) {
      const { error } = await supabase.from('posts').insert({
        creator_id: profile.id,
        idea_id: idea.id,
        platform: idea.platform,
        format: idea.format,
        published_at: new Date().toISOString(),
      });
      if (error) return dbFail('setIdeaStatus create post', error);
      message = 'Marked as posted. A post record was created: log its performance in Analytics.';
    }
    if (next === 'measured' && !posts.some((p) => hasAnyMetric(p))) {
      return fail('Log this post’s metrics in Analytics before marking the idea as measured.');
    }

    const { error } = await supabase.from('ideas').update({ status: next }).eq('id', idea.id).eq('creator_id', profile.id);
    if (error) return dbFail('setIdeaStatus', error);
    touch();
    return ok(message);
  });
}

export async function saveHookVariants(ideaId: string, variants: unknown): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(ideaId, 'Idea');
    if (!idRes.ok) return fail(idRes.error);
    const checked = checkVariants(variants);
    if (!checked || checked.length === 0) return fail('The hook variants were not in the expected format.');
    const { error } = await supabase.from('ideas').update({ hook_variants: checked }).eq('id', idRes.value).eq('creator_id', profile.id);
    if (error) return dbFail('saveHookVariants', error);
    touch();
    return ok('Hook variants saved.');
  });
}

export async function saveScript(ideaId: string, script: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(ideaId, 'Idea');
    if (!idRes.ok) return fail(idRes.error);
    const text = rules.text({ min: 5, max: 5000 })(script, 'Script');
    if (!text.ok) return fail(text.error);
    const { data, error: readError } = await supabase.from('ideas').select('status').eq('id', idRes.value).eq('creator_id', profile.id).maybeSingle();
    if (readError) return dbFail('saveScript read', readError);
    if (!data) return fail('That idea no longer exists.');
    const status = (data as { status: IdeaStatus }).status === 'idea' ? 'scripted' : (data as { status: IdeaStatus }).status;
    const { error } = await supabase.from('ideas').update({ script: text.value, status }).eq('id', idRes.value).eq('creator_id', profile.id);
    if (error) return dbFail('saveScript', error);
    touch();
    return ok('Script saved.');
  });
}

/**
 * Adapt one idea for another platform. A platform-specific angle is required, and both the
 * angle and any caption must differ meaningfully from the source and from earlier adaptations.
 */
export async function adaptIdea(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        source_id: rules.uuid(),
        platform: rules.oneOf(PLATFORMS),
        format: rules.oneOf(FORMATS),
        angle: rules.text({ min: 20, max: 280 }),
        caption: rules.optionalText({ max: 5000 }),
      },
      { source_id: 'Source idea', angle: 'Platform-specific angle', caption: 'Caption' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;

    const { data: rows, error: readError } = await supabase.from('ideas').select('*').eq('creator_id', profile.id).limit(500);
    if (readError) return dbFail('adaptIdea read', readError);
    const ideas = (rows ?? []) as Idea[];
    const source = ideas.find((i) => i.id === d.source_id);
    if (!source) return fail('The source idea no longer exists.');

    if (source.platform === d.platform) {
      return fail('Pick a different platform. Adapting is for taking one idea to another platform.', { platform: 'Pick a platform other than the source.' });
    }
    if (ideas.some((i) => i.adapted_from === source.id && i.platform === d.platform)) {
      return fail(`This idea already has an adaptation for ${d.platform}. Edit that one instead.`, { platform: `Already adapted for ${d.platform}.` });
    }
    const sourceText = `${source.hook ?? ''} ${source.script ?? ''}`;
    if (jaccard(d.angle, source.hook ?? '') >= 0.7) {
      const m = 'This angle is too close to the source hook. Write what is different for this platform.';
      return fail(m, { angle: m });
    }
    if (d.caption) {
      if (jaccard(d.caption, sourceText) >= 0.7) {
        const m = 'The caption is too close to the source. Adapt the tone, length and structure for the platform.';
        return fail(m, { caption: m });
      }
      const sibling = ideas.find((i) => i.script && i.id !== source.id && jaccard(d.caption as string, i.script) >= 0.7);
      if (sibling) {
        const m = `The caption duplicates the one written for ${sibling.platform ?? 'another platform'}. Write a different take.`;
        return fail(m, { caption: m });
      }
    }

    const { error } = await supabase.from('ideas').insert({
      creator_id: profile.id,
      platform: d.platform,
      format: d.format,
      hook: d.angle,
      script: d.caption,
      content_mix: source.content_mix,
      adapted_from: source.id,
      status: d.caption ? 'scripted' : 'idea',
    });
    if (error) return dbFail('adaptIdea', error);
    touch();
    return ok(`Adapted for ${d.platform}.`);
  });
}
