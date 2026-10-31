/**
 * Ad copy rules. Pure, so the checks are tested.
 *
 * PBOS drafts ad copy; it never creates a campaign, never connects to an ads account and never spends money.
 * The creator copies an approved draft into Meta Ads Manager or Google Ads, where the platform reviews it.
 *
 * Limits: Meta publishes recommended lengths (text beyond them can be cut off), and Google Ads publishes hard
 * limits for video action campaigns. Both were checked against the platforms' own documentation; the
 * source links are in docs/INTEGRATIONS.md. Generated copy is held to the limit so nothing is truncated.
 */
import { scanText, type Validated } from './agent/validate';
import { jaccard, REWORD_THRESHOLD } from './similarity';

export type AdFormatKey = 'meta_feed' | 'meta_reels' | 'youtube_video';
export type AdVariant = { angle: string; headline: string; primary_text: string; description: string; cta: string };

type FormatSpec = {
  label: string;
  /** What the platform calls each field. */
  fields: { primary: string; headline: string; description: string | null };
  limits: { primary: number; headline: number; description: number };
  ctas: readonly string[];
  note: string;
};

const META_CTAS = ['Learn more', 'Shop now', 'Sign up', 'Subscribe', 'Download', 'Contact us', 'Book now', 'Get offer', 'Watch more', 'Apply now'] as const;
const GOOGLE_CTAS = ['Learn more', 'Shop now', 'Sign up', 'Subscribe', 'Apply now', 'Book now', 'Contact us', 'Download', 'Visit site', 'Install'] as const;

export const AD_FORMATS: Record<AdFormatKey, FormatSpec> = {
  meta_feed: {
    label: 'Instagram and Facebook feed',
    fields: { primary: 'Primary text', headline: 'Headline', description: 'Description' },
    limits: { primary: 125, headline: 40, description: 30 },
    ctas: META_CTAS,
    note: 'Meta’s recommended lengths: primary text 125, headline 40, description 30. Longer text is allowed but can be cut off.',
  },
  meta_reels: {
    label: 'Instagram and Facebook Reels',
    fields: { primary: 'Primary text', headline: 'Headline', description: null },
    limits: { primary: 72, headline: 40, description: 0 },
    ctas: META_CTAS,
    note: 'Meta recommends about 44 characters of primary text for awareness Reels ads and 72 for traffic. The description is not shown on Reels.',
  },
  youtube_video: {
    label: 'YouTube video ad (Google Ads)',
    fields: { primary: 'Long headline', headline: 'Headline', description: 'Description' },
    limits: { primary: 90, headline: 30, description: 90 },
    ctas: GOOGLE_CTAS,
    note: 'Google Ads video action campaign limits: headline 30, long headline 90, description 90 characters, call to action up to 10.',
  },
};
export const AD_FORMAT_KEYS = Object.keys(AD_FORMATS) as AdFormatKey[];
export const isAdFormat = (v: unknown): v is AdFormatKey => typeof v === 'string' && v in AD_FORMATS;

export const OBJECTIVES = ['Grow awareness', 'Send people to a link', 'Get sign-ups', 'Promote a product or offer'] as const;
export const AD_OFFER_MIN = 10;
export const AD_OFFER_MAX = 600;
export const AD_AUDIENCE_MAX = 300;

/** Claims that ad platforms reject or that would be invented. Matching text is rejected, never softened. */
const AD_BANNED: Array<[RegExp, string]> = [
  [/\b(?:are you|do you|have you)\s+(?:struggling|overweight|depressed|anxious|broke|in debt|lonely|single|suffering|going bald)\b/i, 'asserts a personal attribute about the viewer'],
  [/\b(?:cures?|heals?|treats?|detox\w*|miracle|clinically proven|doctor[- ]approved)\b/i, 'makes a health claim'],
  [/\bbefore (?:and|&) after\b/i, 'implies a before-and-after result'],
  [/\b(?:as seen on|award[- ]winning|best[- ]selling|top[- ]rated|number one|#1|five[- ]star|5[- ]star|trusted by|thousands of|millions of|everyone (?:is|loves)|customers love)\b/i, 'invents social proof'],
  [/\b(?:real results|proven results|results (?:in|within) \w+ (?:days|weeks))\b/i, 'promises a result'],
  [/\b(?:no risk|risk[- ]free|100% (?:safe|free|effective))\b/i, 'makes an absolute claim'],
];

/** Urgency is allowed only when the creator's own offer says it. */
const SCARCITY = /\b(?:only \w+ (?:left|spots?|seats?)|last chance|ends (?:tonight|today|soon)|selling out|limited (?:time|spots?|stock)|hurry)\b/i;

const trim = (s: unknown) => (typeof s === 'string' ? s.trim() : '');

export type AdContext = { format: AdFormatKey; offer: string; allowedNumbers: Set<number> };

/** Everything wrong with one variant. An empty list means it can be shown or saved. */
export function adIssues(v: AdVariant, ctx: AdContext): string[] {
  const spec = AD_FORMATS[ctx.format];
  const out: string[] = [];
  if (v.headline.length < 2) out.push('The headline is empty.');
  if (v.headline.length > spec.limits.headline) out.push(`The headline is ${v.headline.length} characters; ${spec.label} allows ${spec.limits.headline}.`);
  if (v.primary_text.length < 2) out.push(`The ${spec.fields.primary.toLowerCase()} is empty.`);
  if (v.primary_text.length > spec.limits.primary) out.push(`The ${spec.fields.primary.toLowerCase()} is ${v.primary_text.length} characters; ${spec.label} allows ${spec.limits.primary}.`);
  if (spec.fields.description === null) {
    if (v.description) out.push('Reels ads do not show a description. Leave it empty.');
  } else if (v.description.length > spec.limits.description) {
    out.push(`The description is ${v.description.length} characters; ${spec.label} allows ${spec.limits.description}.`);
  }
  if (!spec.ctas.includes(v.cta)) out.push(`The button must be one of: ${spec.ctas.join(', ')}.`);

  const text = [v.headline, v.primary_text, v.description].join(' \n ');
  out.push(...scanText(text, ctx.allowedNumbers, 'The copy'));
  for (const [re, why] of AD_BANNED) if (re.test(text)) out.push(`The copy ${why}.`);
  const scarcity = text.match(SCARCITY);
  if (scarcity && !ctx.offer.toLowerCase().includes(scarcity[0].toLowerCase())) out.push(`The copy adds urgency ("${scarcity[0]}") that your offer does not state.`);
  if (/[<>]/.test(text)) out.push('The copy contains < or >.');
  return Array.from(new Set(out));
}

export function normalizeVariant(raw: unknown): AdVariant | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  return { angle: trim(o.angle).slice(0, 40), headline: trim(o.headline), primary_text: trim(o.primary_text), description: trim(o.description), cta: trim(o.cta) };
}

/** Model output: exactly three distinct variants, each passing every rule above. */
export function validateAdVariants(raw: unknown, ctx: AdContext): Validated<{ variants: AdVariant[] }> {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { variants?: unknown }).variants)) return { ok: false, reasons: ['variants must be an array'] };
  const list = (raw as { variants: unknown[] }).variants;
  const reasons: string[] = [];
  if (list.length !== 3) reasons.push('exactly three variants are required');
  const variants: AdVariant[] = [];
  list.slice(0, 3).forEach((r, i) => {
    const v = normalizeVariant(r);
    if (!v) return void reasons.push(`variants[${i}] is not an object`);
    if (v.angle.length < 2) reasons.push(`variants[${i}] needs a short angle label`);
    for (const issue of adIssues(v, ctx)) reasons.push(`variants[${i}]: ${issue}`);
    variants.push(v);
  });
  for (let i = 0; i < variants.length; i += 1) {
    for (let j = i + 1; j < variants.length; j += 1) {
      if (variants[i].angle.toLowerCase() === variants[j].angle.toLowerCase()) reasons.push('angles must be distinct');
      if (jaccard(`${variants[i].headline} ${variants[i].primary_text}`, `${variants[j].headline} ${variants[j].primary_text}`) >= REWORD_THRESHOLD) reasons.push(`variants ${i + 1} and ${j + 1} are minor rewordings of each other`);
    }
  }
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { variants } };
}

/** Plain text a creator pastes into the ads manager. */
export function adAsText(v: AdVariant, format: AdFormatKey): string {
  const f = AD_FORMATS[format].fields;
  return [`${f.headline}: ${v.headline}`, `${f.primary}: ${v.primary_text}`, f.description && v.description ? `${f.description}: ${v.description}` : null, `Button: ${v.cta}`].filter(Boolean).join('\n');
}
