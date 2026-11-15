import { DEFAULT_CURRENCY } from './constants';
import { effectiveStatus } from './revenue';
import type { RevenueEntry } from './types';

/** Pure numbers behind the Revenue charts. Zeros are real zeros: nothing is estimated or filled in. */

export type InvoiceCounts = { paid: number; invoiced: number; overdue: number; total: number };

export function invoiceCounts(entries: ReadonlyArray<Pick<RevenueEntry, 'status' | 'due_date'>>, now: Date): InvoiceCounts {
  const c: InvoiceCounts = { paid: 0, invoiced: 0, overdue: 0, total: 0 };
  for (const e of entries) {
    c[effectiveStatus(e, now)] += 1;
    c.total += 1;
  }
  return c;
}

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** Money collected (paid) in each of the last `months` calendar months (UTC), oldest first, in one currency. */
export function monthlyCollected(entries: ReadonlyArray<Pick<RevenueEntry, 'status' | 'due_date' | 'paid_at' | 'created_at' | 'amount' | 'currency'>>, now: Date, currency: string, months = 6): Array<{ key: string; label: string; value: number }> {
  const cur = currency.toUpperCase();
  const out: Array<{ key: string; label: string; value: number }> = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push({ key: d.toISOString().slice(0, 7), label: MONTH.format(d), value: 0 });
  }
  for (const e of entries) {
    if (e.status !== 'paid' || (e.currency || DEFAULT_CURRENCY).toUpperCase() !== cur) continue;
    const day = e.paid_at ?? e.created_at.slice(0, 10);
    const slot = out.find((m) => m.key === day.slice(0, 7));
    if (slot) slot.value += Number(e.amount) || 0;
  }
  return out.map((m) => ({ ...m, value: Math.round(m.value * 100) / 100 }));
}

/** Paid money split by where it came from, in one currency. */
export function paidBySource(entries: ReadonlyArray<Pick<RevenueEntry, 'status' | 'amount' | 'currency'> & { source?: string }>, currency: string): { stripe: number; manual: number } {
  const cur = currency.toUpperCase();
  const out = { stripe: 0, manual: 0 };
  for (const e of entries) {
    if (e.status !== 'paid' || (e.currency || DEFAULT_CURRENCY).toUpperCase() !== cur) continue;
    out[e.source === 'stripe' ? 'stripe' : 'manual'] += Number(e.amount) || 0;
  }
  return { stripe: Math.round(out.stripe * 100) / 100, manual: Math.round(out.manual * 100) / 100 };
}

/** The currency with the most money collected, or the fallback when nothing is collected. */
export function mainCurrency(entries: ReadonlyArray<Pick<RevenueEntry, 'status' | 'amount' | 'currency'>>, fallback: string): string {
  const sums = new Map<string, number>();
  for (const e of entries) if (e.status === 'paid') sums.set((e.currency || DEFAULT_CURRENCY).toUpperCase(), (sums.get((e.currency || DEFAULT_CURRENCY).toUpperCase()) ?? 0) + (Number(e.amount) || 0));
  let best = fallback.toUpperCase();
  let top = 0;
  for (const [c, v] of sums) if (v > top) { best = c; top = v; }
  return best;
}
