import { explainAiError } from '../agent/ai-errors';
import { staticProfileContext, staticSystemBlock } from '../agent/prompt';
import type { LlmCall, LlmFailure } from '../agent/llm';
import { collectNumbers } from '../agent/validate';
import { generateValidated, type GenOutcome } from '../generate';
import type { CreatorProfile } from '../types';
import { MOTIONS, SHAPES, STORYBOARD, allowedNumbersFor, validateStoryboard, type PlannedStoryboard } from './plan';
import type { AspectKey } from '../studio/edl';

const AI_DOWN: Record<LlmFailure, string> = {
  not_configured: 'AI is not configured on this server (no AI key is set). You can still write the scenes yourself.',
  timeout: 'The AI service timed out. Try again.',
  network: 'The AI service could not be reached. Try again.',
  http_error: 'The AI service returned an error. Try again.',
  empty: 'The AI service returned an empty answer. Try again.',
  bad_json: 'The AI answer was not valid JSON. Try again.',
};

/**
 * A scene-by-scene plan for a short video about the creator's topic. The model writes captions and picture
 * descriptions only. It may repeat figures the creator gave and may not invent any, and nothing is saved or posted.
 */
export async function planStoryboard(
  llm: LlmCall,
  profile: CreatorProfile,
  input: { topic: string; shape: AspectKey; scenes: number },
): Promise<GenOutcome<PlannedStoryboard>> {
  const allowed = allowedNumbersFor({ topic: input.topic });
  collectNumbers(staticProfileContext(profile), allowed);
  const shape = SHAPES[input.shape];
  const user = `TASK: storyboard_video
Plan a short video as ${input.scenes} scenes. It is shown as ${shape.label} (${shape.hint}) and each scene is one still picture with slow camera movement and a caption on top. Words appear only as captions.
Return ONE JSON object: {"title":"short working title","scenes":[{"caption":"...","picture":"...","seconds":4,"motion":"${MOTIONS.join('|')}"}, ...exactly ${input.scenes}]}
RULES:
- caption: the words shown on screen, at most ${STORYBOARD.captionMax} characters, plain and specific. Scene 1 is a hook that makes someone keep watching. The last scene says what to do next, only if the TOPIC says what that is.
- picture: what the image generator should draw for that scene, ${STORYBOARD.pictureMin} to ${STORYBOARD.pictureMax} characters. Describe a concrete subject, setting and mood. Pictures must not contain any writing, letters, numbers, logos or brand names, and must not depict a real, named person.
- seconds: ${STORYBOARD.minSeconds} to ${STORYBOARD.maxSeconds}, in steps of 0.5. Total length at most ${STORYBOARD.maxTotalSeconds}.
- motion: one of ${MOTIONS.join(', ')}. Vary it from scene to scene.
- Use only what TOPIC and the creator profile say. Do not invent numbers, prices, results, reviews, awards, follower counts or customer counts. Repeat a figure only if TOPIC gives it.
- Do not promise outcomes or guarantee anything. No health, income or before-and-after claims.
- Match the creator's voice from the profile.
TOPIC:
${JSON.stringify(input.topic)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    maxTokens: 2200,
    validate: (raw) => validateStoryboard(raw, { scenes: input.scenes, allowedNumbers: allowed }),
  });
  if (res.ok) return { ok: true, value: res.value, source: 'ai' };
  if (res.reason === 'llm') return { ok: false, code: 'ai_unavailable', message: (res.llmReason === 'http_error' ? explainAiError(res.details?.[0]) : null) ?? AI_DOWN[res.llmReason], details: res.details };
  return { ok: false, code: 'invalid_output', message: `The AI storyboard failed the checks and was rejected${res.details?.length ? ` (${res.details.slice(0, 2).join('; ')})` : ''}. Nothing was saved. Try again, or write the scenes yourself.`, details: res.details };
}
