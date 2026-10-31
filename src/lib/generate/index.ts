import { staticProfileContext, staticSystemBlock } from '../agent/prompt';
import type { LlmCall, LlmFailure } from '../agent/llm';
import { collectNumbers, type Validated } from '../agent/validate';
import { daysBetween } from '../dates';
import { truncate } from '../format';
import { missingProfileFields, type MissingField } from '../profile';
import { daysOverdue, followUpLevel } from '../revenue';
import type { CreatorProfile, Deal, HookVariant, RevenueEntry } from '../types';
import { platformGuide } from './platform';
import { followupTemplates, outreachTemplate } from './templates';
import {
  validateCaption,
  validateFollowups,
  validateHooks,
  validateMediaKit,
  validateOutreach,
  type FollowupDraft,
  type MediaKitProposal,
} from './validators';

export type GenOutcome<T> =
  | { ok: true; value: T; source: 'ai' | 'template'; notice?: string }
  | { ok: false; code: 'ai_unavailable' | 'invalid_output' | 'missing_profile'; message: string; details?: string[]; missing?: MissingField[] };

type Attempt<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'llm'; llmReason: LlmFailure; details?: string[] }
  | { ok: false; reason: 'invalid'; details: string[] };

/** Call the model, validate, and retry once with the rejection reasons fed back. */
export async function generateValidated<T>(
  llm: LlmCall,
  args: { staticSystem: string; user: string; validate: (raw: unknown) => Validated<T>; maxTokens?: number; retries?: number },
): Promise<Attempt<T>> {
  const retries = args.retries ?? 1;
  let user = args.user;
  let details: string[] = [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await llm({ staticSystem: args.staticSystem, user, maxTokens: args.maxTokens ?? 1200 });
    if (!res.ok) return { ok: false, reason: 'llm', llmReason: res.reason, details: res.detail ? [res.detail] : undefined };
    const checked = args.validate(res.json);
    if (checked.ok) return { ok: true, value: checked.value };
    details = checked.reasons;
    user = `${args.user}\n\nYour previous answer was rejected for these reasons: ${checked.reasons.join('; ')}. Fix them and answer again with only the JSON object.`;
  }
  return { ok: false, reason: 'invalid', details };
}

const AI_DOWN: Record<LlmFailure, string> = {
  not_configured: 'AI is not configured on this server (ANTHROPIC_API_KEY is missing).',
  timeout: 'The AI service timed out. Try again.',
  network: 'The AI service could not be reached. Try again.',
  http_error: 'The AI service returned an error. Try again.',
  empty: 'The AI service returned an empty answer. Try again.',
  bad_json: 'The AI answer was not valid JSON. Try again.',
};

function failure(a: Extract<Attempt<unknown>, { ok: false }>): Extract<GenOutcome<never>, { ok: false }> {
  if (a.reason === 'llm') return { ok: false, code: 'ai_unavailable', message: AI_DOWN[a.llmReason], details: a.details };
  return {
    ok: false,
    code: 'invalid_output',
    message: 'The AI answer failed the safety and quality checks and was rejected. Nothing was saved. Try again.',
    details: a.details,
  };
}

const allowedNumbers = (context: unknown, profile?: CreatorProfile) => {
  const set = collectNumbers(context);
  if (profile) collectNumbers(staticProfileContext(profile), set);
  return set;
};

/* ── 1. Hook variants ──────────────────────────────────────────────────── */

export async function generateHooks(
  llm: LlmCall,
  profile: CreatorProfile,
  input: { hook: string; platform: string | null; format: string | null },
): Promise<GenOutcome<{ variants: HookVariant[] }>> {
  const context = { core_hook: input.hook, platform: input.platform, format: input.format };
  const user = `TASK: hook_variants
Return ONE JSON object: {"variants":[{"angle":"short label","hook":"the hook"}, ...exactly three]}
RULES:
- Three genuinely different angles on the same core idea (for example: contrarian, personal story, practical how-to, question, myth-busting). Each angle must change the idea, not just the wording.
- Each hook is a single line under 160 characters, written for the platform and format given.
- Do not add numbers, statistics, results or claims that are not in the core hook.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    validate: (raw) => validateHooks(raw, { coreHook: input.hook, allowedNumbers: allowedNumbers(context) }),
  });
  return res.ok ? { ok: true, value: res.value, source: 'ai' } : failure(res);
}

/* ── 2. Platform-adapted caption / script ──────────────────────────────── */

export async function generateCaption(
  llm: LlmCall,
  profile: CreatorProfile,
  input: { coreMessage: string; platform: string; format: string | null; angle: string | null; avoid: string[] },
): Promise<GenOutcome<{ caption: string; structure: string | null }>> {
  const guide = platformGuide(input.platform);
  const context = {
    core_message: truncate(input.coreMessage, 1000),
    platform: guide.name,
    format: input.format,
    platform_specific_angle: input.angle ? truncate(input.angle, 300) : null,
    captions_already_written_for_other_platforms: input.avoid.slice(0, 3).map((a) => truncate(a, 300)),
  };
  const user = `TASK: platform_caption
Return ONE JSON object: {"caption":"the caption or short script","structure":"one short line naming the structure you used"}
RULES:
- Start from the core message and adapt tone, length and structure for ${guide.name}. Platform guidance: ${guide.guidance}
- Hard limit: ${guide.max} characters.
- Do not copy the core message or any caption already written for another platform. If a platform-specific angle is given, build the caption around it.
- Match the creator voice from the profile. Do not add numbers, statistics, results or claims that are not in CONTEXT.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    validate: (raw) =>
      validateCaption(raw, {
        platform: guide.name,
        coreMessage: input.coreMessage,
        avoid: input.avoid,
        allowedNumbers: allowedNumbers({ a: input.coreMessage, b: input.angle, c: input.avoid }),
      }),
  });
  return res.ok ? { ok: true, value: res.value, source: 'ai' } : failure(res);
}

/* ── 3. Outreach email ─────────────────────────────────────────────────── */

export async function generateOutreach(
  llm: LlmCall,
  profile: CreatorProfile,
  deal: Deal,
  now: Date,
): Promise<GenOutcome<{ subject: string; body: string }>> {
  const context = {
    creator_name: profile.name,
    deal: {
      brand: deal.brand,
      contact_name: deal.contact_name,
      stage: deal.stage,
      days_in_stage: daysBetween(deal.stage_updated_at, now),
      deliverables: (deal.deliverables ?? []).slice(0, 8).map((d) => truncate(String(d), 100)),
      notes: truncate(deal.notes, 300) || null,
    },
  };
  const user = `TASK: outreach_email
Return ONE JSON object: {"subject":"...","body":"..."}
RULES:
- Short and specific: under 150 words, plain text, no markdown. Greet the contact by name when given.
- Fit the deal stage: prospecting = introduce and propose a conversation; negotiating = follow up on open terms; contracted = confirm kickoff steps; delivery = check in on delivery; paid = thank them and open a follow-up conversation.
- Mention the brand and only the deliverables listed. One clear ask.
- No exaggerated claims, no audience or performance numbers, no pricing, no promises of results. No binding legal language.
- Sign off with the creator name.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    validate: (raw) => validateOutreach(raw, { brand: deal.brand, allowedNumbers: allowedNumbers(context, profile) }),
  });
  if (res.ok) return { ok: true, value: res.value, source: 'ai' };
  const f = failure(res);
  return {
    ok: true,
    value: outreachTemplate(profile, deal),
    source: 'template',
    notice: `${f.message} This is a template built from your profile and the deal record.`,
  };
}

/* ── 4. Media kit proposals ────────────────────────────────────────────── */

export function mediaKitGaps(profile: CreatorProfile): MissingField[] {
  return missingProfileFields(profile).filter((f) => f.needed_for.includes('media kit'));
}

export async function generateMediaKit(llm: LlmCall, profile: CreatorProfile): Promise<GenOutcome<MediaKitProposal>> {
  const gaps = mediaKitGaps(profile);
  const blocking = gaps.filter((g) => g.field === 'positioning' || g.field === 'niche' || g.field === 'name');
  if (blocking.length > 0) {
    return {
      ok: false,
      code: 'missing_profile',
      message: `Complete your ${blocking.map((b) => b.label.toLowerCase()).join(', ')} first. PBOS will not guess it.`,
      missing: gaps,
    };
  }
  const context = {
    existing_positioning: profile.positioning,
    existing_collaboration_options: (profile.services ?? []).map((s) => s.name),
    existing_faq_questions: (profile.faq ?? []).map((f) => f.q),
    rate_card_present: (profile.rate_card ?? []).length > 0,
  };
  const user = `TASK: media_kit_copy
Return ONE JSON object: {"positioning_line":"...","services":[{"name":"...","description":"..."}],"faq":[{"q":"...","a":"..."}]}
RULES:
- positioning_line: one sentence under 140 characters built only from the creator profile.
- services: improve the descriptions of the existing collaboration options by name. Do not invent new offerings. Return an empty array when there are none.
- faq: up to three questions a brand would ask, answerable from the profile. Skip questions whose answer you would have to invent (pricing, audience size, turnaround). Do not repeat existing questions.
- No numbers, statistics or outcomes that are not in the profile. No promises. No binding legal language.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    validate: (raw) => validateMediaKit(raw, { allowedNumbers: allowedNumbers(context, profile) }),
  });
  return res.ok ? { ok: true, value: res.value, source: 'ai' } : failure(res);
}

/* ── 5. Invoice follow-ups ─────────────────────────────────────────────── */

export async function generateFollowups(
  llm: LlmCall,
  profile: CreatorProfile,
  invoice: RevenueEntry,
  deal: Deal | null,
  now: Date,
): Promise<GenOutcome<{ drafts: FollowupDraft[]; suggested_level: 1 | 2 | 3 }>> {
  const days = daysOverdue(invoice, now);
  const suggested_level = followUpLevel(days);
  const context = {
    creator_name: profile.name,
    invoice: {
      amount: Number(invoice.amount),
      currency: invoice.currency,
      due_date: invoice.due_date,
      days_overdue: days,
      brand: deal?.brand ?? null,
      contact_name: deal?.contact_name ?? null,
    },
  };
  const user = `TASK: invoice_followups
Return ONE JSON object: {"drafts":[{"level":1,"subject":"...","body":"..."},{"level":2,...},{"level":3,...}]}
RULES:
- Three escalating drafts for the same overdue invoice: level 1 friendly reminder, level 2 direct follow-up, level 3 final notice.
- Professional and non-threatening at every level. Level 3 is firm and polite and asks for payment or a firm payment date. No legal threats, no collections language, no late fees, no binding legal wording.
- Use only the invoice facts in CONTEXT. Use bracketed placeholders such as [payment details] and [reply-by date] for anything you were not given.
- Plain text. Sign off with the creator name.
CONTEXT:
${JSON.stringify(context)}`;
  const res = await generateValidated(llm, {
    staticSystem: staticSystemBlock(profile),
    user,
    validate: (raw) => validateFollowups(raw, { allowedNumbers: allowedNumbers(context) }),
  });
  if (res.ok) return { ok: true, value: { drafts: res.value.drafts, suggested_level }, source: 'ai' };
  const f = failure(res);
  return {
    ok: true,
    value: { drafts: followupTemplates(profile, invoice, deal, now), suggested_level },
    source: 'template',
    notice: `${f.message} These are templates built from the invoice record.`,
  };
}
