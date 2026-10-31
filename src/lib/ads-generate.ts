import { staticSystemBlock } from './agent/prompt';
import { collectNumbers } from './agent/validate';
import { AD_FORMATS, validateAdVariants, type AdFormatKey, type AdVariant } from './ads';
import { generateValidated, type GenOutcome } from './generate';
import { staticProfileContext } from './agent/prompt';
import type { LlmCall, LlmFailure } from './agent/llm';
import type { CreatorProfile } from './types';

const AI_DOWN: Record<LlmFailure, string> = {
  not_configured: 'AI is not configured on this server (ANTHROPIC_API_KEY is missing).',
  timeout: 'The AI service timed out. Try again.',
  network: 'The AI service could not be reached. Try again.',
  http_error: 'The AI service returned an error. Try again.',
  empty: 'The AI service returned an empty answer. Try again.',
  bad_json: 'The AI answer was not valid JSON. Try again.',
};

/** Three ad copy variants for one platform, built only from the creator's stated offer and audience. */
export async function generateAds(
  llm: LlmCall,
  profile: CreatorProfile,
  input: { format: AdFormatKey; objective: string; offer: string; audience: string },
): Promise<GenOutcome<{ variants: AdVariant[] }>> {
  const spec = AD_FORMATS[input.format];
  const context = { objective: input.objective, offer: input.offer, audience: input.audience, platform: spec.label };
  const allowed = collectNumbers(context);
  collectNumbers(staticProfileContext(profile), allowed);
  const user = `TASK: ad_copy
Return ONE JSON object: {"variants":[{"angle":"short label","headline":"...","primary_text":"...","description":"...","cta":"..."}, ...exactly three]}
PLATFORM: ${spec.label}. ${spec.note}
FIELD LIMITS (characters, hard): headline ${spec.limits.headline}; ${spec.fields.primary.toLowerCase()} (JSON key primary_text) ${spec.limits.primary}; description ${spec.fields.description === null ? 'must be an empty string' : spec.limits.description}.
BUTTON (cta) must be exactly one of: ${spec.ctas.join(' | ')}.
RULES:
- Three genuinely different angles (for example: the benefit, the problem it solves, a question). Each must change the message, not just the wording.
- Use only what OFFER and AUDIENCE say. Do not invent numbers, prices, discounts, results, reviews, awards, follower counts or customer counts.
- Do not promise outcomes or guarantee anything. Do not make health claims, before-and-after claims or income claims. Do not address the viewer's personal traits ("Are you overweight?").
- Do not add urgency or scarcity unless the OFFER itself states it.
- Plain, specific, honest. Match the creator's voice from the profile.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    maxTokens: 1500,
    validate: (raw) => validateAdVariants(raw, { format: input.format, offer: input.offer, allowedNumbers: allowed }),
  });
  if (res.ok) return { ok: true, value: res.value, source: 'ai' };
  if (res.reason === 'llm') return { ok: false, code: 'ai_unavailable', message: AI_DOWN[res.llmReason], details: res.details };
  return { ok: false, code: 'invalid_output', message: 'The AI answer failed the ad-copy checks and was rejected. Nothing was saved. Try again, or make the offer more specific.', details: res.details };
}
