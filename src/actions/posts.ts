'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { FORMATS, PLATFORMS } from '@/lib/constants';
import type { ActionResult, Idea } from '@/lib/types';
import { parse, rules } from '@/lib/validation';

const touch = () => ['/analytics', '/ideas', '/dashboard', '/work-with-me'].forEach((p) => revalidatePath(p));

/** Manually add a post that was published outside PBOS. Metrics are logged separately and never guessed. */
export async function createPost(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return withCreator<{ id: string }>(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        platform: rules.oneOf(PLATFORMS),
        format: rules.oneOf(FORMATS),
        published_at: rules.optionalDateTime(),
        idea_id: rules.optionalUuid(),
        notes: rules.optionalText({ max: 500 }),
        title: rules.optionalText({ max: 200 }),
      },
      { published_at: 'Published at', idea_id: 'Idea', notes: 'Notes', title: 'Title' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;
    if (d.published_at && new Date(d.published_at).getTime() > Date.now() + 60_000) {
      return fail('A post cannot be published in the future. Leave the date empty or use today.', { published_at: 'Use a past or current date.' });
    }
    const { data: row, error } = await supabase.from('posts').insert({
      creator_id: profile.id,
      platform: d.platform,
      format: d.format,
      published_at: d.published_at ?? new Date().toISOString(),
      idea_id: d.idea_id,
      notes: d.notes,
      ...(d.title ? { title: d.title } : {}),
    }).select('id').single();
    if (error) return dbFail('createPost', error);
    touch();
    return { ok: true, message: 'Post added. Log its performance when you have the numbers.', data: { id: (row as { id: string }).id } };
  });
}

const metric = rules.optionalNumber({ min: 0, max: 2_000_000_000, int: true });

export async function logMetrics(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        post_id: rules.uuid(),
        views: metric,
        likes: metric,
        comments: metric,
        shares: metric,
        saves: metric,
        clicks: metric,
        notes: rules.optionalText({ max: 500 }),
      },
      { post_id: 'Post', notes: 'Notes' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const { post_id, notes, ...m } = parsed.data;
    if (Object.values(m).every((v) => v === null)) {
      return fail('Enter at least one metric from the platform’s own analytics. PBOS does not estimate numbers.');
    }

    const { data: post, error: readError } = await supabase.from('posts').select('id, idea_id').eq('id', post_id).eq('creator_id', profile.id).maybeSingle();
    if (readError) return dbFail('logMetrics read', readError);
    if (!post) return fail('That post no longer exists.');

    const { error } = await supabase.from('posts').update({ ...m, notes }).eq('id', post_id).eq('creator_id', profile.id);
    if (error) return dbFail('logMetrics', error);

    // Close the loop: a posted idea becomes measured once its post has numbers.
    const ideaId = (post as { idea_id: string | null }).idea_id;
    if (ideaId) {
      const { data: idea } = await supabase.from('ideas').select('status').eq('id', ideaId).eq('creator_id', profile.id).maybeSingle();
      if ((idea as Pick<Idea, 'status'> | null)?.status === 'posted') {
        await supabase.from('ideas').update({ status: 'measured' }).eq('id', ideaId).eq('creator_id', profile.id);
      }
    }
    touch();
    return ok(m.views === null ? 'Saved. Add views to include this post in engagement comparisons.' : 'Metrics saved.');
  });
}

export async function deletePost(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const v = rules.uuid()(id, 'Post');
    if (!v.ok) return fail(v.error);
    const { error } = await supabase.from('posts').delete().eq('id', v.value).eq('creator_id', profile.id);
    if (error) return dbFail('deletePost', error);
    touch();
    return ok('Post deleted.');
  });
}
