import { PILLARS, type Pillar } from '../constants';
import type { Candidate, DraftIntent, DraftOutput, Flag } from './types';

/* ──────────────────────────────────────────────────────────────────────────
 * Guardrails applied to every piece of model output before it is shown or saved.
 * ────────────────────────────────────────────────────────────────────────── */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMBER_RE = /\d[\d,]*(?:\.\d+)?/g;

const norm = (n: number) => Math.round(n * 1e6) / 1e6;

/** Numeric tokens in text. UUIDs are removed first so their digits are not counted. */
export function numbersIn(text: string): number[] {
  const cleaned = text.replace(UUID_RE, ' ');
  const found = cleaned.match(NUMBER_RE) ?? [];
  return found.map((s) => norm(parseFloat(s.replace(/,/g, '')))).filter((n) => Number.isFinite(n));
}

/**
 * Every number present in the data given to the model (ids excluded).
 * Model output may only contain numbers from this set.
 */
export function collectNumbers(value: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) into.add(norm(value));
  } else if (typeof value === 'string') {
    numbersIn(value).forEach((n) => into.add(n));
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectNumbers(v, into));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'id' || k.endsWith('_id') || k.endsWith('_ids') || k === 'source_record_ids') continue;
      collectNumbers(v, into);
    }
  }
  return into;
}

const SHORTHAND_RE = /(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?([kKmM])(?![a-zA-Z])/g;

/**
 * Numbers in something the CREATOR typed. Like collectNumbers, and "12k" or "1.2M" also count as 12000 and
 * 1200000, because that is how people write view counts. The number the agent saves must still be one the
 * creator actually gave.
 */
export function collectUserNumbers(text: string, into: Set<number> = new Set()): Set<number> {
  collectNumbers(text, into);
  for (const m of text.matchAll(SHORTHAND_RE)) {
    const base = parseFloat(m[1].replace(/,/g, ''));
    if (Number.isFinite(base)) into.add(norm(m[2].toLowerCase() === 'k' ? base * 1_000 : base * 1_000_000));
  }
  return into;
}

const BANNED: Array<[RegExp, string]> = [
  [/\bguarantee[sd]?\b/i, 'guarantees an outcome'],
  [/\bwill (?:definitely |certainly |surely |easily )?(?:earn|make you|generate|bring|land|get you|grow|double|triple|increase|boost)\b/i, 'promises an outcome'],
  [/\bgo(?:es|ing)? viral\b|\bviral hit\b|\bovernight success\b/i, 'hype claim'],
  [/\b(?:10x|100x|skyrocket\w*|explode your)\b/i, 'hype claim'],
  [/\bpassive income\b|\bget rich\b/i, 'income claim'],
  [/\b(?:hereby|indemnif\w*|governing law|whereas|irrevocabl\w*|legally binding|binding agreement)\b/i, 'binding legal language'],
  [/\b(?:legal action|lawsuit|attorney|collections agency|sue you|small claims)\b/i, 'legal threat'],
];

/** Only the banned-claims half of scanText: guarantees, hype, income claims, binding legal language, legal threats. */
export function scanClaims(text: string, label = 'text'): string[] {
  const reasons: string[] = [];
  for (const [re, why] of BANNED) {
    if (re.test(text)) reasons.push(`${label} ${why}`);
  }
  return Array.from(new Set(reasons));
}

const FIGURE_RE = new RegExp(
  [
    // A currency amount: $1,200 / €50 / £3.5k
    String.raw`[$€£]\s?(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?(?![a-zA-Z])`,
    // A count or share with a unit: 12k followers, 40%, 1,200 views
    String.raw`(\d[\d,]*(?:\.\d+)?)\s?([kKmM])?\s?(?:%|percent\b|followers|subscribers|views|likes|customers|clients|members|sales|downloads|users|students|people|creators)`,
  ].join('|'),
  'gi',
);

/**
 * For creative copy (hooks, captions, scripts): ordinary list numbers like "5 mistakes" are fine, but a figure
 * that reads like a result (a price, a percentage, an audience size, a view count) must come from the creator's
 * own data or message. Catches "grew 300%", "our 50k community", "$2,000 a month".
 */
export function scanFigures(text: string, allowedNumbers: Set<number>, label = 'text'): string[] {
  const reasons: string[] = [];
  for (const m of text.matchAll(FIGURE_RE)) {
    const raw = m[1] ?? m[3];
    const suffix = (m[2] ?? m[4] ?? '').toLowerCase();
    if (!raw) continue;
    const base = parseFloat(raw.replace(/,/g, ''));
    if (!Number.isFinite(base)) continue;
    const value = norm(suffix === 'k' ? base * 1_000 : suffix === 'm' ? base * 1_000_000 : base);
    if (!allowedNumbers.has(value) && !allowedNumbers.has(norm(base))) reasons.push(`${label} contains a figure that is not in your data: ${m[0].trim()}`);
  }
  return Array.from(new Set(reasons));
}

export function scanText(text: string, allowedNumbers: Set<number>, label = 'text'): string[] {
  const reasons: string[] = [];
  for (const n of numbersIn(text)) {
    if (!allowedNumbers.has(n)) reasons.push(`${label} contains unsupported number ${n}`);
  }
  for (const [re, why] of BANNED) {
    if (re.test(text)) reasons.push(`${label} ${why}`);
  }
  return Array.from(new Set(reasons));
}

/* ── Daily loop output ──────────────────────────────────────────────────── */

export type DailyValidationContext = {
  allowedIds: Set<string>;
  flags: Flag[];
  candidates: Candidate[];
  allowedNumbers: Set<number>;
  draftIntent: DraftIntent | null;
};

export type ValidDaily = {
  flags: Flag[];
  recommendations: Array<{ key: string; pillar: Pillar; action: string; reason: string; source_record_ids: string[] }>;
  draft: DraftOutput | null;
};

export type Validated<T> = { ok: true; value: T } | { ok: false; reasons: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isPillar = (v: unknown): v is Pillar => typeof v === 'string' && (PILLARS as readonly string[]).includes(v);

function readIds(v: unknown, allowed: Set<string>, label: string, reasons: string[]): string[] {
  if (!Array.isArray(v) || v.length === 0 || !v.every((x) => typeof x === 'string')) {
    reasons.push(`${label} must cite at least one source_record_id`);
    return [];
  }
  const ids = v as string[];
  const unknown = ids.filter((id) => !allowed.has(id));
  if (unknown.length > 0) reasons.push(`${label} cites unknown record ids`);
  return ids;
}

const overlap = (a: string[], b: string[]) => a.filter((x) => b.includes(x)).length;

export function validateDaily(raw: unknown, ctx: DailyValidationContext): Validated<ValidDaily> {
  const reasons: string[] = [];
  if (!isObj(raw)) return { ok: false, reasons: ['response is not a JSON object'] };

  // flags
  const flags: Flag[] = [];
  if (!Array.isArray(raw.flags)) reasons.push('flags must be an array');
  else {
    if (raw.flags.length > ctx.flags.length) reasons.push('more flags returned than were provided');
    const used = new Set<string>();
    raw.flags.forEach((f, i) => {
      if (!isObj(f)) return void reasons.push(`flags[${i}] is not an object`);
      if (!isPillar(f.pillar)) return void reasons.push(`flags[${i}].pillar is invalid`);
      if (typeof f.message !== 'string' || f.message.trim().length === 0 || f.message.length > 300) {
        return void reasons.push(`flags[${i}].message is missing or too long`);
      }
      const ids = readIds(f.source_record_ids, ctx.allowedIds, `flags[${i}]`, reasons);
      const match = ctx.flags
        .filter((c) => c.pillar === f.pillar && !used.has(c.key))
        .map((c) => ({ c, o: overlap(c.source_record_ids, ids) }))
        .filter((m) => m.o > 0)
        .sort((a, b) => b.o - a.o)[0];
      if (!match) return void reasons.push(`flags[${i}] does not correspond to a deterministic finding`);
      used.add(match.c.key);
      reasons.push(...scanText(f.message, ctx.allowedNumbers, `flags[${i}]`));
      flags.push({ key: match.c.key, pillar: f.pillar, message: f.message.trim(), source_record_ids: ids });
    });
  }

  // recommendations
  const recommendations: ValidDaily['recommendations'] = [];
  const maxRecs = Math.min(3, ctx.candidates.length);
  if (!Array.isArray(raw.recommendations)) reasons.push('recommendations must be an array');
  else {
    if (raw.recommendations.length < Math.min(1, maxRecs)) reasons.push('no recommendations returned');
    if (raw.recommendations.length > maxRecs) reasons.push('more recommendations returned than were provided');
    const used = new Set<string>();
    raw.recommendations.forEach((r, i) => {
      if (!isObj(r)) return void reasons.push(`recommendations[${i}] is not an object`);
      if (!isPillar(r.pillar)) return void reasons.push(`recommendations[${i}].pillar is invalid`);
      if (typeof r.action !== 'string' || r.action.trim().length === 0 || r.action.length > 260) {
        return void reasons.push(`recommendations[${i}].action is missing or too long`);
      }
      if (typeof r.reason !== 'string' || r.reason.trim().length === 0 || r.reason.length > 420) {
        return void reasons.push(`recommendations[${i}].reason is missing or too long`);
      }
      const ids = readIds(r.source_record_ids, ctx.allowedIds, `recommendations[${i}]`, reasons);
      const match = ctx.candidates
        .filter((c) => c.pillar === r.pillar && !used.has(c.key))
        .map((c) => ({ c, o: overlap(c.source_record_ids, ids) }))
        .filter((m) => m.o > 0)
        .sort((a, b) => b.o - a.o)[0];
      if (!match) return void reasons.push(`recommendations[${i}] does not correspond to a deterministic finding`);
      used.add(match.c.key);
      reasons.push(...scanText(`${r.action} ${r.reason}`, ctx.allowedNumbers, `recommendations[${i}]`));
      recommendations.push({
        key: match.c.key,
        pillar: r.pillar,
        action: r.action.trim(),
        reason: r.reason.trim(),
        source_record_ids: ids,
      });
    });
  }

  // draft
  let draft: DraftOutput | null = null;
  const rawDraft = raw.draft;
  if (!ctx.draftIntent) {
    if (rawDraft !== null && rawDraft !== undefined) reasons.push('a draft was returned but none was requested');
  } else if (!isObj(rawDraft)) {
    reasons.push('draft is missing');
  } else {
    const intent = ctx.draftIntent;
    if (rawDraft.type !== intent.draftType) reasons.push('draft.type does not match the requested asset');
    if (typeof rawDraft.platform !== 'string' || rawDraft.platform.toLowerCase() !== intent.platform.toLowerCase()) {
      reasons.push('draft.platform does not match the requested platform');
    }
    const content = typeof rawDraft.content === 'string' ? rawDraft.content.trim() : '';
    if (content.length < 20) reasons.push('draft.content is missing or too short');
    else if (content.length > 2500) reasons.push('draft.content is too long');
    else {
      reasons.push(...scanText(content, ctx.allowedNumbers, 'draft'));
      draft = { key: intent.key, type: intent.draftType, platform: intent.platform, content, source_record_ids: intent.source_record_ids };
    }
  }

  const unique = Array.from(new Set(reasons));
  if (unique.length > 0) return { ok: false, reasons: unique };
  return { ok: true, value: { flags, recommendations, draft } };
}
