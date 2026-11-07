'use server';

import { dbFail, fail, withCreator } from '@/lib/action-helpers';
import { generateFreeImage } from '@/lib/images/free';
import { IMAGE_PROMPT_MAX, generateOpenAiImage, type ImageResult } from '@/lib/images/openai';
import { planStoryboard } from '@/lib/storyboard/generate';
import { sceneImageDailyLimit } from '@/lib/storyboard/limits';
import { STORYBOARD, SHAPES, isShape, isStyle, picturePrompt, type PlannedStoryboard } from '@/lib/storyboard/plan';
import { callLlm } from '@/lib/server/ai';
import { rateLimit } from '@/lib/server/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';

/** Drafts the scenes for a video. Nothing is saved: the creator edits the scenes in the browser. */
export async function planVideo(formData: FormData): Promise<ActionResult<PlannedStoryboard>> {
  return withCreator<PlannedStoryboard>(async ({ profile }) => {
    const topic = String(formData.get('topic') ?? '').trim();
    const shape = String(formData.get('shape') ?? '9:16');
    const count = Number.parseInt(String(formData.get('scenes') ?? ''), 10);
    if (topic.length < STORYBOARD.topicMin) return fail(`What is the video about? Write at least ${STORYBOARD.topicMin} characters.`, { topic: `Write at least ${STORYBOARD.topicMin} characters.` });
    if (topic.length > STORYBOARD.topicMax) return fail(`Keep the topic under ${STORYBOARD.topicMax} characters.`, { topic: `Keep it under ${STORYBOARD.topicMax} characters.` });
    if (!isShape(shape)) return fail('Choose a video shape.', { shape: 'Choose a video shape.' });
    if (!Number.isInteger(count) || count < STORYBOARD.minScenes || count > STORYBOARD.maxScenes) return fail(`Choose ${STORYBOARD.minScenes} to ${STORYBOARD.maxScenes} scenes.`, { scenes: `Choose ${STORYBOARD.minScenes} to ${STORYBOARD.maxScenes}.` });
    if (!rateLimit(`video-plan:${profile.id}`, 8, 10 * 60_000).allowed) return fail('Too many storyboards in a short time. Wait a few minutes.');

    const res = await planStoryboard(callLlm, profile, { topic, shape, scenes: count });
    if (!res.ok) return fail(res.message);
    return { ok: true, message: 'Storyboard ready. Edit anything, then make the pictures.', data: res.value };
  });
}

/**
 * Makes ONE picture for ONE scene and sends it straight back to the browser. Nothing is stored: the video is made in
 * the browser, and only the finished video can be saved to the library. The free service is used unless an OpenAI
 * key is set, and it is also the fallback when OpenAI fails.
 */
export async function makeScenePicture(formData: FormData): Promise<ActionResult<{ dataUrl: string; width: number; height: number }>> {
  return withCreator<{ dataUrl: string; width: number; height: number }>(async ({ profile }) => {
    const picture = String(formData.get('picture') ?? '').trim();
    const shape = String(formData.get('shape') ?? '9:16');
    const style = String(formData.get('style') ?? 'photo');
    if (picture.length < STORYBOARD.pictureMin) return fail(`Describe the picture in at least ${STORYBOARD.pictureMin} characters.`);
    if (picture.length > STORYBOARD.pictureMax) return fail(`Keep the picture description under ${STORYBOARD.pictureMax} characters.`);
    if (!isShape(shape) || !isStyle(style)) return fail('Choose a shape and a look for the pictures.');
    const prompt = picturePrompt(picture, style).slice(0, IMAGE_PROMPT_MAX);
    const aspect = SHAPES[shape].image;

    const db = createAdminClient();
    if (!db) return fail('Picture limits are not set up on this deployment yet (SUPABASE_SERVICE_ROLE_KEY is missing).');
    if (!rateLimit(`video-pic:${profile.id}`, 6, 60_000).allowed) return fail('Too many pictures in a minute. Wait a moment.');

    const day = new Date().toISOString().slice(0, 10);
    const bumped = await db.rpc('bump_api_usage', { p_creator: profile.id, p_provider: 'image', p_bucket: 'storyboard', p_day: day, p_units: 1 });
    if (bumped.error) return dbFail('makeScenePicture.quota', bumped.error);
    if (Number(bumped.data ?? 0) > sceneImageDailyLimit()) return fail(`You have used today's ${sceneImageDailyLimit()} scene pictures. The allowance resets at midnight UTC.`);

    const free = () => generateFreeImage({ prompt, aspect }, { apiKey: process.env.POLLINATIONS_API_KEY || undefined });
    let result: ImageResult = process.env.OPENAI_API_KEY
      ? await generateOpenAiImage({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_IMAGE_MODEL }, { prompt, aspect, quality: 'low' })
      : await free();
    if (!result.ok && process.env.OPENAI_API_KEY && result.reason !== 'refused') result = await free();
    if (!result.ok) {
      await db.from('integration_events').insert({ creator_id: profile.id, platform: 'image', type: 'image_failed', detail: { reason: result.reason, where: 'storyboard' } });
      return fail(result.message);
    }
    return { ok: true, data: { dataUrl: `data:image/jpeg;base64,${Buffer.from(result.bytes).toString('base64')}`, width: result.width, height: result.height } };
  });
}
