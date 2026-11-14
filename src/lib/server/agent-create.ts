import 'server-only';
import { createDeal } from '@/actions/deals';
import { createIdea, saveHookVariants, saveScript } from '@/actions/ideas';
import { createInvoice } from '@/actions/revenue';
import { createPost } from '@/actions/posts';
import { generateAdVariants, saveAdDraft } from '@/actions/ads';
import { generateImage } from '@/actions/images';
import { saveDrafts } from '@/actions/publish';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { GLOBAL_LIMIT_MESSAGE, underGlobalLimit } from '@/lib/server/budget';
import { renderEdit } from '@/lib/server/render';
import type { ToolRunResult } from '@/lib/agent/runner';
import type { AddDealArgs, AddInvoiceArgs, CreateIdeaArgs, HookVariantsArgs, LogPostArgs, PlanEditArgs, PlanVideoArgs, RenderEditArgs, PublishDraftArgs, WriteScriptArgs, DraftAdArgs, GenerateImageArgs } from '@/lib/agent/tools/specs';
import type { CreatorContext } from '@/lib/auth';

/**
 * 'create' tools: each makes a NEW record by calling the same server action the page uses. The action does the
 * checking (ownership, near-duplicates, media rules, limits); this file only maps the agent's validated
 * arguments onto it and describes the result in a sentence the model can repeat accurately.
 */

type Fields = Record<string, string | string[] | null | undefined>;

export function form(fields: Fields): FormData {
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

/* ── hand-off plans and money records ──────────────────────────────────── */

/**
 * A storyboard plan is only words, so there is nothing to write to a table: the plan lives on the agent's own activity
 * row (the runner stores the validated arguments) and the card links to /video?plan=<that row's id>.
 */
export async function planVideoFor(a: PlanVideoArgs): Promise<ToolRunResult> {
  return {
    ok: true,
    text: JSON.stringify({
      created: 'video plan', scenes: a.scenes.length, seconds: a.scenes.reduce((n, s) => n + s.seconds, 0),
      note: 'A PLAN only. No video exists yet. The creator opens the link on the card: the Video page loads the plan, draws a picture for each scene, adds music and records the video in their browser. Say it is waiting there, never that the video is made.',
    }),
  };
}

/** The edit plan names videos from the library, so each one is checked to be the creator's own video and long enough for its trim. */
export async function planEditFor({ supabase, profile }: CreatorContext, a: PlanEditArgs): Promise<ToolRunResult> {
  const ids = Array.from(new Set(a.clips.map((c) => c.media_id)));
  const { data, error } = await supabase.from('media_assets').select('id, kind, label, duration_s').in('id', ids).eq('creator_id', profile.id);
  if (error) return bad('The library could not be read right now. Nothing was changed.');
  const found = new Map((data as Array<{ id: string; kind: string; label: string | null; duration_s: number | null }> | null ?? []).map((r) => [r.id, r]));
  for (const [i, c] of a.clips.entries()) {
    const m = found.get(c.media_id);
    if (!m) return bad(`Clip ${i + 1}: there is no library item with that id. Use an id from list_records kind media.`);
    if (m.kind !== 'video') return bad(`Clip ${i + 1}: “${m.label ?? 'that item'}” is not a video. Only videos can be edited in the Studio.`);
    if (m.duration_s !== null && c.end > m.duration_s + 0.05) return bad(`Clip ${i + 1}: “${m.label ?? 'that video'}” is only ${m.duration_s} seconds long, so end ${c.end} is past its end.`);
  }
  const seconds = Math.round(a.clips.reduce((n, c) => n + (c.end - c.start), 0) * 10) / 10;
  return {
    ok: true,
    text: JSON.stringify({
      created: 'studio edit plan', clips: a.clips.length, seconds,
      note: 'A PLAN only. Nothing has been cut or exported. The creator opens the link on the card: the Studio loads the videos from the library, they preview it and press Export in their browser. Say it is waiting there, never that the video is edited.',
    }),
  };
}

export async function createDealFor(a: AddDealArgs): Promise<ToolRunResult> {
  const res = await createDeal(form({
    brand: a.brand, contact_name: a.contact_name, contact_email: a.contact_email, stage: a.stage,
    value: a.value === null ? null : String(a.value), expected_close_date: a.expected_close_date, deliverables: a.deliverables, notes: a.notes,
  }));
  if (!res.ok) return bad(res.error);
  return made('deal', res.data!.id, '/deals', { brand: a.brand, stage: a.stage, note: 'Added to the pipeline. Nobody was contacted.' });
}

export async function createInvoiceFor({ supabase, profile }: CreatorContext, a: AddInvoiceArgs): Promise<ToolRunResult> {
  if (a.deal_id) {
    const { data, error } = await supabase.from('deals').select('id').eq('id', a.deal_id).eq('creator_id', profile.id).maybeSingle();
    if (error) return bad('The deal could not be read right now. Nothing was changed.');
    if (!data) return bad('There is no deal with that id. Use an id from list_records kind deals, or leave deal_id out.');
  }
  const res = await createInvoice(form({ deal_id: a.deal_id, amount: String(a.amount), currency: a.currency, status: a.status, due_date: a.due_date, notes: a.notes }));
  if (!res.ok) return bad(res.error);
  return made('invoice', res.data!.id, '/revenue', { amount: a.amount, status: a.status, note: 'Recorded for tracking only. PBOS did not issue or send this invoice and no money has moved.' });
}

/** Renders a daily allowance for server-side video edits. Small on purpose: each one uses real compute. */
export const renderDailyLimit = () => {
  const n = Number(process.env.PBOS_RENDER_DAILY_LIMIT);
  return Number.isInteger(n) && n >= 0 ? n : 5;
};

export async function renderEditFor({ supabase, profile, user }: CreatorContext, a: RenderEditArgs): Promise<ToolRunResult> {
  const ids = Array.from(new Set(a.clips.map((c) => c.media_id)));
  const { data, error } = await supabase.from('media_assets').select('id, kind, label, duration_s, bucket, storage_path, bytes').in('id', ids).eq('creator_id', profile.id);
  if (error) return bad('The library could not be read right now. Nothing was changed.');
  type Row = { id: string; kind: string; label: string | null; duration_s: number | null; bucket: string; storage_path: string; bytes: number | null };
  const found = new Map(((data as Row[] | null) ?? []).map((r) => [r.id, r]));
  for (const [i, c] of a.clips.entries()) {
    const m = found.get(c.media_id);
    if (!m) return bad(`Clip ${i + 1}: there is no library item with that id. Use an id from list_records kind media.`);
    if (m.kind !== 'video') return bad(`Clip ${i + 1}: “${m.label ?? 'that item'}” is not a video.`);
    if (m.duration_s !== null && c.end > m.duration_s + 0.05) return bad(`Clip ${i + 1}: “${m.label ?? 'that video'}” is only ${m.duration_s} seconds long, so end ${c.end} is past its end.`);
  }
  const db = createAdminClient();
  if (!db) return bad('File storage is not set up on this deployment yet, so nothing was rendered.');
  if (!(await underGlobalLimit(db))) return bad(GLOBAL_LIMIT_MESSAGE);
  const limit = renderDailyLimit();
  const bumped = await db.rpc('bump_api_usage', { p_creator: profile.id, p_provider: 'agent', p_bucket: 'render', p_day: new Date().toISOString().slice(0, 10), p_units: 1 });
  if (bumped.error) return bad('The render allowance could not be checked right now. Nothing was rendered.');
  if (Number(bumped.data ?? 0) > limit) return bad(`The creator has used today’s ${limit} video renders. The allowance resets at midnight UTC. Nothing was rendered.`);

  const urls: Array<{ url: string; bytes: number | null }> = [];
  for (const id of ids) {
    const m = found.get(id) as Row;
    const signed = await db.storage.from(m.bucket).createSignedUrl(m.storage_path, 900);
    if (signed.error || !signed.data?.signedUrl) return bad('A source video could not be opened. Nothing was rendered.');
    urls.push({ url: signed.data.signedUrl, bytes: m.bytes });
  }
  const out = await renderEdit(
    { aspect: a.aspect, fit: a.fit, clips: a.clips.map((c) => ({ input: ids.indexOf(c.media_id), start: c.start, end: c.end, volume: c.volume })), texts: a.texts },
    urls,
  );
  if (!out.ok) return bad(out.error);

  const path = `${user.id}/${randomUUID()}.mp4`;
  const up = await db.storage.from('creator-media').upload(path, out.bytes, { contentType: 'video/mp4', upsert: false, cacheControl: '3600' });
  if (up.error) return bad('The video was rendered but could not be saved. Try again.');
  const label = (a.label ?? `Edit ${new Date().toISOString().slice(0, 10)}`).slice(0, 200);
  const row = await supabase.from('media_assets').insert({
    creator_id: profile.id, kind: 'video', source: 'upload', storage_path: path, mime_type: 'video/mp4', bytes: out.bytes.length,
    width: out.width, height: out.height, duration_s: out.seconds, label, ai_generated: false,
  }).select('id').single();
  if (row.error) { await db.storage.from('creator-media').remove([path]); return bad('The video was rendered but could not be recorded. Nothing was saved.'); }
  const id = (row.data as { id: string }).id;
  return made('media', id, '/library', {
    media_id: id, seconds: out.seconds, size: `${out.width}x${out.height}`, bytes: out.bytes.length,
    note: 'The finished video is in the media library (the originals are untouched). Nothing has been posted. To post it: create_publish_draft with this media_id, then publish_post, which the creator must approve.',
  });
}
