'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { dbFail, fail, withCreator } from '@/lib/action-helpers';
import { ASPECTS, IMAGE_PROMPT_MAX, IMAGE_PROMPT_MIN, generateOpenAiImage, type Aspect, type Quality } from '@/lib/images/openai';
import { rateLimit } from '@/lib/server/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';

const touch = () => ['/library', '/publish', '/ads'].forEach((p) => revalidatePath(p));
const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/** Per-creator daily cap on generations. Failed attempts count, because the provider charges or rate-limits them too. */
function dailyLimit(): number {
  const n = Number.parseInt(process.env.IMAGE_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 10;
}

/**
 * Generates one image from a description, stores it privately in the creator's own folder, and adds it to the
 * library labelled as AI-generated. Nothing is posted anywhere; posting goes through the Publish page and its
 * approval step.
 */
export async function generateImage(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return withCreator<{ id: string }>(async ({ supabase, profile, user }) => {
    const prompt = String(formData.get('prompt') ?? '').trim();
    const aspect = String(formData.get('aspect') ?? 'square') as Aspect;
    const qualityRaw = String(formData.get('quality') ?? 'medium') as Quality;
    if (prompt.length < IMAGE_PROMPT_MIN) return fail(`Describe the image in at least ${IMAGE_PROMPT_MIN} characters.`, { prompt: `Describe the image in at least ${IMAGE_PROMPT_MIN} characters.` });
    if (prompt.length > IMAGE_PROMPT_MAX) return fail(`Keep the description under ${IMAGE_PROMPT_MAX} characters.`, { prompt: `Keep the description under ${IMAGE_PROMPT_MAX} characters.` });
    if (!(aspect in ASPECTS)) return fail('Choose a shape for the image.', { aspect: 'Choose a shape for the image.' });
    const quality: Quality = QUALITIES.includes(qualityRaw) ? qualityRaw : 'medium';

    if (!process.env.OPENAI_API_KEY) return fail('Image generation is not set up on this deployment (OPENAI_API_KEY is missing).');
    const db = createAdminClient();
    if (!db) return fail('File storage is not set up on this deployment yet (SUPABASE_SERVICE_ROLE_KEY is missing).');
    if (!rateLimit(`image:${profile.id}`, 4, 60_000).allowed) return fail('Too many images in a minute. Wait a moment.');

    // Reserve one unit of today's allowance atomically before calling the provider.
    const day = new Date().toISOString().slice(0, 10);
    const bumped = await db.rpc('bump_api_usage', { p_creator: profile.id, p_provider: 'image', p_bucket: 'generate', p_day: day, p_units: 1 });
    if (bumped.error) return dbFail('generateImage.quota', bumped.error);
    const used = Number(bumped.data ?? 0);
    if (used > dailyLimit()) return fail(`You have used today's ${dailyLimit()} image generations. The allowance resets at midnight UTC.`);

    const result = await generateOpenAiImage({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_IMAGE_MODEL }, { prompt, aspect, quality });
    if (!result.ok) {
      await db.from('integration_events').insert({ creator_id: profile.id, platform: 'image', type: 'image_failed', detail: { reason: result.reason } });
      return fail(result.message);
    }

    const path = `${user.id}/${randomUUID()}.jpg`;
    const up = await db.storage.from('creator-media').upload(path, result.bytes, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
    if (up.error) {
      console.error('[images] storage upload failed');
      return fail('The image was generated but could not be saved. Try again.');
    }
    const row = await supabase.from('media_assets').insert({
      creator_id: profile.id, kind: 'image', source: 'generated', storage_path: path, mime_type: 'image/jpeg', bytes: result.bytes.length,
      width: result.width, height: result.height, label: prompt.slice(0, 80), prompt, provider: result.provider, model: result.model, ai_generated: true,
    }).select('id').single();
    if (row.error) {
      await db.storage.from('creator-media').remove([path]);
      return dbFail('generateImage.insert', row.error);
    }
    await db.from('integration_events').insert({ creator_id: profile.id, platform: 'image', type: 'image_generated', detail: { aspect, quality, model: result.model } });
    touch();
    return { ok: true, message: 'Image added to your library, labelled as AI-generated.', data: { id: (row.data as { id: string }).id } };
  });
}
