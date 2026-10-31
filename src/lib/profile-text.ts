import { parsePipeLines } from './validation';
import type { FaqItem, RateItem, Service } from './types';

/**
 * The settings form edits services, the rate card, the FAQ and deliverables as plain
 * text, one item per line with " | " between fields. These helpers convert both ways.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function servicesFromText(text: string): Parsed<Service[]> {
  const lines = parsePipeLines(text, 2);
  if (lines.length > 8) return { ok: false, error: 'Collaboration options: add at most 8 lines.' };
  const out: Service[] = [];
  for (const [i, cells] of lines.entries()) {
    const name = cells[0] ?? '';
    const description = cells[1] ?? '';
    if (!name || name.length > 60) return { ok: false, error: `Collaboration options, line ${i + 1}: the name must be 1-60 characters.` };
    if (description.length > 240) return { ok: false, error: `Collaboration options, line ${i + 1}: keep the description under 240 characters.` };
    out.push({ name, description });
  }
  return { ok: true, value: out };
}

export const servicesToText = (s: Service[]): string => s.map((x) => `${x.name} | ${x.description}`.replace(/ \| $/, '')).join('\n');

export function rateCardFromText(text: string, currency: string): Parsed<RateItem[]> {
  const lines = parsePipeLines(text, 3);
  if (lines.length > 12) return { ok: false, error: 'Rate card: add at most 12 lines.' };
  const out: RateItem[] = [];
  for (const [i, cells] of lines.entries()) {
    const item = cells[0] ?? '';
    if (!item || item.length > 80) return { ok: false, error: `Rate card, line ${i + 1}: the item name must be 1-80 characters.` };
    let price: number | null = null;
    if (cells[1]) {
      const n = Number(cells[1].replace(/[,$€£\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `Rate card, line ${i + 1}: the price must be a number, or leave it blank for "contact for pricing".` };
      price = n;
    }
    const notes = cells[2]?.slice(0, 160);
    out.push({ item, price, currency, ...(notes ? { notes } : {}) });
  }
  return { ok: true, value: out };
}

export const rateCardToText = (items: RateItem[]): string =>
  items.map((r) => [r.item, r.price === null ? '' : String(r.price), r.notes ?? ''].join(' | ').replace(/( \| )+$/, '')).join('\n');

export function faqFromText(text: string): Parsed<FaqItem[]> {
  const lines = parsePipeLines(text, 2);
  if (lines.length > 10) return { ok: false, error: 'FAQ: add at most 10 lines.' };
  const out: FaqItem[] = [];
  for (const [i, cells] of lines.entries()) {
    const q = cells[0] ?? '';
    const a = cells[1] ?? '';
    if (!q || !a) return { ok: false, error: `FAQ, line ${i + 1}: write "Question | Answer".` };
    if (q.length > 160 || a.length > 600) return { ok: false, error: `FAQ, line ${i + 1}: question under 160 and answer under 600 characters.` };
    out.push({ q, a });
  }
  return { ok: true, value: out };
}

export const faqToText = (items: FaqItem[]): string => items.map((f) => `${f.q} | ${f.a}`).join('\n');

export function deliverablesFromText(text: string): Parsed<string[]> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length > 10) return { ok: false, error: 'Deliverables: add at most 10 lines.' };
  if (lines.some((l) => l.length > 120)) return { ok: false, error: 'Deliverables: keep each line under 120 characters.' };
  return { ok: true, value: lines };
}

export const deliverablesToText = (items: string[]): string => items.join('\n');
