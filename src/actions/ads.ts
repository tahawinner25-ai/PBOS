'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { collectNumbers } from '@/lib/agent/validate';
import { staticProfileContext } from '@/lib/agent/prompt';
import { AD_AUDIENCE_MAX, AD_OFFER_MAX, AD_OFFER_MIN, OBJECTIVES, adIssues, isAdFormat, normalizeVariant, type AdFormatKey, type AdVariant } from '@/lib/ads';
import { generateAds } from '@/lib/ads-generate';
import { callLlm } from '@/lib/server/ai';
import { rateLimit } from '@/lib/server/rate-limit';
import type { ActionResult } from '@/lib/types';

const touch = () => revalidatePath('/ads');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AdBrief = { format: AdFormatKey; objective: string; offer: string; audience: string };

/** Drafts three variants. Nothing is saved until the creator saves one. */
export async function generateAdVariants(formData: FormData): Promise<ActionResult<{ variants: AdVariant[]; brief: AdBrief }>> {
  return withCreator<{ variants: AdVariant[]; brief: AdBrief }>(async ({ profile }) => {
    const format = String(formData.get('format') ?? '');
    const objective = String(formData.get('objective') ?? '');
    const offer = String(formData.get('offer') ?? '').trim();
    const audienceInput = String(formData.get('audience') ?? '').trim();
    if (!isAdFormat(format)) return fail('Choose where the ad will run.', { format: 'Choose where the ad will run.' });
    if (!(OBJECTIVES as readonly string[]).includes(objective)) return fail('Choose what the ad is for.', { objective: 'Choose what the ad is for.' });
    if (offer.length < AD_OFFER_MIN) return fail(`What are you promoting? Describe it in at least ${AD_OFFER_MIN} characters.`, { offer: `Describe what you are promoting in at least ${AD_OFFER_MIN} characters.` });
    if (offer.length > AD_OFFER_MAX) return fail(`Keep the offer under ${AD_OFFER_MAX} characters.`, { offer: `Keep it under ${AD_OFFER_MAX} characters.` });
    if (audienceInput.length > AD_AUDIENCE_MAX) return fail(`Keep the audience under ${AD_AUDIENCE_MAX} characters.`, { audience: `Keep it under ${AD_AUDIENCE_MAX} characters.` });
    // One targeted question when the one thing the copy depends on is missing.
    const audience = audienceInput || (profile.audience_notes ?? '').trim().slice(0, AD_AUDIENCE_MAX);
    if (!audience) return fail('Who is this ad for? One sentence is enough.', { audience: 'Who is this ad for? One sentence is enough (it is also missing from your profile).' });
    if (!rateLimit(`ads:${profile.id}`, 8, 10 * 60_000).allowed) return fail('Too many drafts in a short time. Wait a few minutes.');

    const brief: AdBrief = { format, objective, offer, audience };
    const res = await generateAds(callLlm, profile, brief);
    if (!res.ok) return fail(res.message);
    return { ok: true, message: 'Three drafts are ready. Edit them, then save the one you want.', data: { variants: res.value.variants, brief } };
  });
}

/**
 * Saves one variant as a draft. The text is checked again here against the same rules, because the creator may
 * have edited it and the browser is not trusted. Nothing is submitted to any ads platform.
 */
export async function saveAdDraft(input: { brief: AdBrief; variant: AdVariant; mediaAssetId?: string | null }): Promise<ActionResult<{ id: string }>> {
  return withCreator<{ id: string }>(async ({ supabase, profile }) => {
    const brief = input?.brief;
    if (!brief || !isAdFormat(brief.format) || typeof brief.offer !== 'string' || typeof brief.audience !== 'string' || typeof brief.objective !== 'string') return fail('That draft is not valid. Generate it again.');
    if (!(OBJECTIVES as readonly string[]).includes(brief.objective) || brief.offer.length > AD_OFFER_MAX || brief.audience.length > AD_AUDIENCE_MAX) return fail('That draft is not valid. Generate it again.');
    const variant = normalizeVariant(input.variant);
    if (!variant) return fail('That draft is not valid. Generate it again.');

    const allowed = collectNumbers({ o: brief.offer, a: brief.audience, objective: brief.objective });
    collectNumbers(staticProfileContext(profile), allowed);
    const issues = adIssues(variant, { format: brief.format, offer: brief.offer, allowedNumbers: allowed });
    if (issues.length) return fail(issues[0], { draft: issues.join(' ') });

    let mediaId: string | null = null;
    if (input.mediaAssetId) {
      if (!UUID.test(input.mediaAssetId)) return fail('That image was not found.');
      const m = await supabase.from('media_assets').select('id').eq('id', input.mediaAssetId).eq('creator_id', profile.id).maybeSingle();
      if (m.error) return dbFail('saveAdDraft.media', m.error);
      if (!m.data) return fail('That image was not found.');
      mediaId = input.mediaAssetId;
    }
    const row = await supabase.from('ad_creatives').insert({
      creator_id: profile.id, platform: brief.format, objective: brief.objective, offer: brief.offer, audience: brief.audience,
      headline: variant.headline, primary_text: variant.primary_text, description: variant.description || null, cta: variant.cta,
      variants: [variant], media_asset_id: mediaId, status: 'draft', ai_generated: true,
      source_record_ids: ['stated_offer', brief.audience === (profile.audience_notes ?? '').trim().slice(0, AD_AUDIENCE_MAX) ? 'profile.audience_notes' : 'stated_audience'],
    }).select('id').single();
    if (row.error) return dbFail('saveAdDraft', row.error);
    touch();
    return { ok: true, message: 'Draft saved. Copy it into your ads manager when you are ready.', data: { id: (row.data as { id: string }).id } };
  });
}

export async function setAdStatus(id: string, status: 'draft' | 'approved' | 'archived'): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(id) || !['draft', 'approved', 'archived'].includes(status)) return fail('That draft was not found.');
    const { data, error } = await supabase.from('ad_creatives').update({ status }).eq('id', id).eq('creator_id', profile.id).select('id');
    if (error) return dbFail('setAdStatus', error);
    if (!data?.length) return fail('That draft was not found.');
    touch();
    return ok(status === 'approved' ? 'Marked as ready. Nothing was sent anywhere.' : status === 'archived' ? 'Archived.' : 'Moved back to draft.');
  });
}

export async function deleteAdDraft(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!UUID.test(id)) return fail('That draft was not found.');
    const { error } = await supabase.from('ad_creatives').delete().eq('id', id).eq('creator_id', profile.id);
    if (error) return dbFail('deleteAdDraft', error);
    touch();
    return ok('Deleted.');
  });
}
