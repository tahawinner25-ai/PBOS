import 'server-only';
import { createIdea, saveHookVariants, saveScript } from '@/actions/ideas';
import { createPost } from '@/actions/posts';
import { generateAdVariants, saveAdDraft } from '@/actions/ads';
import { generateImage } from '@/actions/images';
import { saveDrafts } from '@/actions/publish';
import type { ToolRunResult } from '@/lib/agent/runner';
import type { CreateIdeaArgs, HookVariantsArgs, LogPostArgs, PublishDraftArgs, WriteScriptArgs, DraftAdArgs, GenerateImageArgs } from '@/lib/agent/tools/specs';
import type { CreatorContext } from '@/lib/auth';

/**
 * 'create' tools: each makes a NEW record by calling the same server action the page uses. The action does the
 * checking (ownership, near-duplicates, media rules, limits); this file only maps the agent's validated
 * arguments onto it and describes the result in a sentence the model can repeat accurately.
 */

type Fields = Record<string, string | string[] | null | undefined>;

function form(fields: Fields): FormData {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) f.append(key, item);
  }
  return f;
}

const bad = (error: string): ToolRunResult => ({ ok: false, error });
const made = (kind: string, id: string, href: string, text: Record<string, unknown>, undo?: Record<string, string>): ToolRunResult => ({
  ok: true,
  text: JSON.stringify({ created: kind, id, ...text }),
  record: { kind, id, href },
  ...(undo ? { undo } : {}),
});

export async function createIdeaFor(a: CreateIdeaArgs): Promise<ToolRunResult> {
  const res = await createIdea(form({ platform: a.platform, format: a.format, hook: a.hook, content_mix: a.content_mix, scheduled_for: a.scheduled_for }));
  if (!res.ok) return bad(res.error);
  return made('idea', res.data!.id, '/ideas', { hook: a.hook, status: a.scheduled_for ? 'scheduled' : 'idea' });
}

export async function saveIdeaScript({ supabase, profile }: CreatorContext, a: WriteScriptArgs): Promise<ToolRunResult> {
  const { data, error } = await supabase.from('ideas').select('id, script, status').eq('id', a.idea_id).eq('creator_id', profile.id).maybeSingle();
  if (error) return bad('The idea could not be read right now. Nothing was changed.');
  if (!data) return bad('There is no idea with that id. Use an id from list_records.');
  const idea = data as { id: string; script: string | null; status: string };
  if (idea.script && idea.script.trim()) return bad('That idea already has a script. The creator’s own words are not overwritten. Offer a separate draft with write_draft instead.');
  const res = await saveScript(a.idea_id, a.script);
  if (!res.ok) return bad(res.error);
  // `prev` lets Undo put the status back exactly as it was.
  return made('idea_script', idea.id, '/ideas', { characters: a.script.length }, { prev_status: idea.status });
}

export async function saveIdeaVariants({ supabase, profile }: CreatorContext, a: HookVariantsArgs): Promise<ToolRunResult> {
  const { data, error } = await supabase.from('ideas').select('id, hook_variants').eq('id', a.idea_id).eq('creator_id', profile.id).maybeSingle();
  if (error) return bad('The idea could not be read right now. Nothing was changed.');
  if (!data) return bad('There is no idea with that id. Use an id from list_records.');
  const idea = data as { id: string; hook_variants: unknown[] | null };
  if (Array.isArray(idea.hook_variants) && idea.hook_variants.length > 0) return bad('That idea already has hook variants. They are not overwritten.');
  const res = await saveHookVariants(a.idea_id, a.variants);
  if (!res.ok) return bad(res.error);
  return made('idea_variants', idea.id, '/ideas', { variants: a.variants.length });
}

export async function createDraftJob({ supabase, profile }: CreatorContext, a: PublishDraftArgs): Promise<ToolRunResult> {
  const res = await saveDrafts(form({
    destinations: a.destination,
    title: a.title,
    caption: a.caption,
    tags: a.tags.join(','),
    privacy: a.privacy,
    made_for_kids: a.made_for_kids === null ? undefined : a.made_for_kids ? 'yes' : 'no',
    scheduled_for: a.scheduled_for,
    media_ids: a.media_asset_ids,
    idea_id: a.idea_id,
  }));
  if (!res.ok) return bad(res.error);
  const { data, error } = await supabase.from('publish_jobs').select('id').eq('batch_id', res.data!.batchId).eq('creator_id', profile.id).limit(1);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (error || !id) return bad('The draft was saved, but its id could not be read back. Ask the creator to check the Publish page.');
  const youtube = a.destination.startsWith('youtube');
  return made('publish_job', id, '/publish', {
    status: 'draft',
    note: youtube
      ? 'This is a DRAFT. Nothing is scheduled or uploaded. The creator must open the Publish page, press Approve, and choose the video file.'
      : 'This is a DRAFT. Nothing is scheduled or posted. The creator must open the Publish page and press Approve.',
  });
}

export async function createImageFor(a: GenerateImageArgs): Promise<ToolRunResult> {
  const res = await generateImage(form({ prompt: a.prompt, aspect: a.aspect, quality: 'medium' }));
  if (!res.ok) return bad(res.error);
  return made('media', res.data!.id, '/library', { note: 'The image is in the media library, labelled AI-generated. It has not been used in any post.' });
}

export async function createAd(a: DraftAdArgs): Promise<ToolRunResult> {
  const gen = await generateAdVariants(form({ format: a.format, objective: a.objective, offer: a.offer, audience: a.audience }));
  if (!gen.ok) return bad(gen.error);
  const { variants, brief } = gen.data!;
  const best = variants[0];
  if (!best) return bad('No ad copy came back. Nothing was saved.');
  const saved = await saveAdDraft({ brief, variant: best });
  if (!saved.ok) return bad(saved.error);
  return made('ad', saved.data!.id, '/ads', {
    status: 'draft',
    headline: best.headline,
    primary_text: best.primary_text,
    cta: best.cta,
    note: 'Saved as a draft in the Ads Studio. Nothing was submitted to any ads platform.',
  });
}

export async function createPostFor(a: LogPostArgs): Promise<ToolRunResult> {
  const res = await createPost(form({ platform: a.platform, format: a.format, published_at: a.published_at, title: a.title, notes: a.notes }));
  if (!res.ok) return bad(res.error);
  return made('post', res.data!.id, '/analytics', { note: 'Recorded as published. No metrics are stored; add figures only from numbers the creator gives you.' });
}
