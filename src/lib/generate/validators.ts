import { jaccard, REWORD_THRESHOLD } from '../similarity';
import { scanText, type Validated } from '../agent/validate';
import type { FaqItem, HookVariant, Service } from '../types';
import { platformGuide } from './platform';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Captions must be adapted, not copied: above this similarity they are rejected. */
export const CAPTION_COPY_THRESHOLD = 0.7;

/* ── Hook variants ─────────────────────────────────────────────────────── */

export function validateHooks(
  raw: unknown,
  ctx: { coreHook: string; allowedNumbers: Set<number> },
): Validated<{ variants: HookVariant[] }> {
  const reasons: string[] = [];
  if (!isObj(raw) || !Array.isArray(raw.variants)) return { ok: false, reasons: ['variants must be an array'] };
  if (raw.variants.length !== 3) reasons.push('exactly three variants are required');

  const variants: HookVariant[] = [];
  raw.variants.slice(0, 3).forEach((v, i) => {
    if (!isObj(v)) return void reasons.push(`variants[${i}] is not an object`);
    const angle = str(v.angle);
    const hook = str(v.hook);
    if (angle.length < 2 || angle.length > 40) reasons.push(`variants[${i}].angle must be 2-40 characters`);
    if (hook.length < 5 || hook.length > 160) reasons.push(`variants[${i}].hook must be 5-160 characters`);
    reasons.push(...scanText(`${angle} ${hook}`, ctx.allowedNumbers, `variants[${i}]`));
    if (jaccard(hook, ctx.coreHook) >= REWORD_THRESHOLD) reasons.push(`variants[${i}] only rewords the core hook`);
    variants.push({ angle, hook });
  });

  for (let i = 0; i < variants.length; i += 1) {
    for (let j = i + 1; j < variants.length; j += 1) {
      if (variants[i].angle.toLowerCase() === variants[j].angle.toLowerCase()) reasons.push('angles must be distinct');
      if (jaccard(variants[i].hook, variants[j].hook) >= REWORD_THRESHOLD) {
        reasons.push(`variants ${i + 1} and ${j + 1} are minor rewordings of each other`);
      }
    }
  }

  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { variants } };
}

/* ── Platform-adapted caption ──────────────────────────────────────────── */

export function validateCaption(
  raw: unknown,
  ctx: { platform: string; coreMessage: string; avoid: string[]; allowedNumbers: Set<number> },
): Validated<{ caption: string; structure: string | null }> {
  if (!isObj(raw)) return { ok: false, reasons: ['response is not a JSON object'] };
  const reasons: string[] = [];
  const caption = str(raw.caption);
  const guide = platformGuide(ctx.platform);
  if (caption.length < 10) reasons.push('caption is missing or too short');
  if (caption.length > guide.max) reasons.push(`caption exceeds the ${guide.max} character limit for ${guide.name}`);
  reasons.push(...scanText(caption, ctx.allowedNumbers, 'caption'));
  if (jaccard(caption, ctx.coreMessage) >= CAPTION_COPY_THRESHOLD) reasons.push('caption is too close to the core message; adapt it for the platform');
  for (const other of ctx.avoid) {
    if (other && jaccard(caption, other) >= CAPTION_COPY_THRESHOLD) reasons.push('caption duplicates a caption already written for another platform');
  }
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { caption, structure: str(raw.structure) || null } };
}

/* ── Outreach email ────────────────────────────────────────────────────── */

export function validateOutreach(
  raw: unknown,
  ctx: { brand: string | null; allowedNumbers: Set<number> },
): Validated<{ subject: string; body: string }> {
  if (!isObj(raw)) return { ok: false, reasons: ['response is not a JSON object'] };
  const reasons: string[] = [];
  const subject = str(raw.subject);
  const body = str(raw.body);
  if (subject.length < 3 || subject.length > 120) reasons.push('subject must be 3-120 characters');
  if (body.length < 40) reasons.push('body is missing or too short');
  if (words(body) > 200) reasons.push('body is longer than 200 words');
  if (body.length > 1600) reasons.push('body is too long');
  if (ctx.brand && !`${subject} ${body}`.toLowerCase().includes(ctx.brand.toLowerCase())) reasons.push('email does not mention the brand');
  reasons.push(...scanText(`${subject}\n${body}`, ctx.allowedNumbers, 'email'));
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { subject, body } };
}

/* ── Invoice follow-ups ────────────────────────────────────────────────── */

export const FOLLOWUP_LABELS = { 1: 'Friendly reminder', 2: 'Direct follow-up', 3: 'Final notice' } as const;
export type FollowupDraft = { level: 1 | 2 | 3; label: string; subject: string; body: string };

export function validateFollowups(
  raw: unknown,
  ctx: { allowedNumbers: Set<number> },
): Validated<{ drafts: FollowupDraft[] }> {
  if (!isObj(raw) || !Array.isArray(raw.drafts)) return { ok: false, reasons: ['drafts must be an array'] };
  const rawDrafts: unknown[] = raw.drafts;
  const reasons: string[] = [];
  if (rawDrafts.length !== 3) reasons.push('exactly three drafts are required');
  const drafts: FollowupDraft[] = [];
  ([1, 2, 3] as const).forEach((level, i) => {
    const d = rawDrafts[i];
    if (!isObj(d)) return void reasons.push(`drafts[${i}] is missing`);
    if (Number(d.level) !== level) reasons.push(`drafts[${i}] must be level ${level}`);
    const subject = str(d.subject);
    const body = str(d.body);
    if (subject.length < 3 || subject.length > 120) reasons.push(`drafts[${i}].subject must be 3-120 characters`);
    if (body.length < 30 || body.length > 1200) reasons.push(`drafts[${i}].body has an invalid length`);
    reasons.push(...scanText(`${subject}\n${body}`, ctx.allowedNumbers, `drafts[${i}]`));
    drafts.push({ level, label: FOLLOWUP_LABELS[level], subject, body });
  });
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { drafts } };
}

/* ── Media kit proposals ───────────────────────────────────────────────── */

export type MediaKitProposal = { positioning_line: string | null; services: Service[]; faq: FaqItem[] };

export function validateMediaKit(raw: unknown, ctx: { allowedNumbers: Set<number> }): Validated<MediaKitProposal> {
  if (!isObj(raw)) return { ok: false, reasons: ['response is not a JSON object'] };
  const reasons: string[] = [];
  const positioning = str(raw.positioning_line);
  if (positioning.length > 140) reasons.push('positioning_line must be 140 characters or fewer');
  if (positioning) reasons.push(...scanText(positioning, ctx.allowedNumbers, 'positioning_line'));

  const services: Service[] = [];
  if (raw.services !== undefined && !Array.isArray(raw.services)) reasons.push('services must be an array');
  (Array.isArray(raw.services) ? raw.services : []).slice(0, 6).forEach((s, i) => {
    if (!isObj(s)) return void reasons.push(`services[${i}] is not an object`);
    const name = str(s.name);
    const description = str(s.description);
    if (!name || name.length > 60) reasons.push(`services[${i}].name is invalid`);
    if (description.length < 10 || description.length > 240) reasons.push(`services[${i}].description is invalid`);
    reasons.push(...scanText(`${name} ${description}`, ctx.allowedNumbers, `services[${i}]`));
    services.push({ name, description });
  });

  const faq: FaqItem[] = [];
  if (raw.faq !== undefined && !Array.isArray(raw.faq)) reasons.push('faq must be an array');
  (Array.isArray(raw.faq) ? raw.faq : []).slice(0, 3).forEach((f, i) => {
    if (!isObj(f)) return void reasons.push(`faq[${i}] is not an object`);
    const q = str(f.q);
    const a = str(f.a);
    if (q.length < 5 || q.length > 160) reasons.push(`faq[${i}].q is invalid`);
    if (a.length < 10 || a.length > 400) reasons.push(`faq[${i}].a is invalid`);
    reasons.push(...scanText(`${q} ${a}`, ctx.allowedNumbers, `faq[${i}]`));
    faq.push({ q, a });
  });

  if (!positioning && services.length === 0 && faq.length === 0) reasons.push('nothing was proposed');
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { positioning_line: positioning || null, services, faq } };
}
