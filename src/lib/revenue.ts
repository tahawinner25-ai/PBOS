import { DEAL_STAGES, DEFAULT_CURRENCY, STAGE_PROBABILITY, type DealStage } from './constants';
import { isoDayDiff, todayISO } from './dates';
import type { Deal, RevenueEntry } from './types';

export type EffectiveStatus = 'paid' | 'overdue' | 'invoiced';

/** An invoice is overdue when marked overdue, or still "invoiced" past its due date. */
export function effectiveStatus(e: Pick<RevenueEntry, 'status' | 'due_date'>, now: Date): EffectiveStatus {
  if (e.status === 'paid') return 'paid';
  if (e.status === 'overdue') return 'overdue';
  if (e.due_date && e.due_date < todayISO(now)) return 'overdue';
  return 'invoiced';
}

export function daysOverdue(e: Pick<RevenueEntry, 'due_date'>, now: Date): number {
  if (!e.due_date) return 0;
  return Math.max(0, isoDayDiff(e.due_date, todayISO(now)));
}

/** 1 = friendly reminder, 2 = direct follow-up, 3 = final notice. */
export function followUpLevel(days: number): 1 | 2 | 3 {
  if (days >= 14) return 3;
  if (days >= 7) return 2;
  return 1;
}

export type CurrencyTotals = { currency: string; collected: number; outstanding: number; overdue: number };

/**
 * Totals per currency (never summed across currencies).
 * outstanding = every unpaid invoice (including overdue); overdue is the subset past due.
 */
export function revenueTotals(entries: RevenueEntry[], now: Date): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  for (const e of entries) {
    const cur = (e.currency || DEFAULT_CURRENCY).toUpperCase();
    const t = map.get(cur) ?? { currency: cur, collected: 0, outstanding: 0, overdue: 0 };
    const amount = Number(e.amount) || 0;
    const status = effectiveStatus(e, now);
    if (status === 'paid') t.collected += amount;
    else {
      t.outstanding += amount;
      if (status === 'overdue') t.overdue += amount;
    }
    map.set(cur, t);
  }
  return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency));
}

export type PipelineRow = { stage: DealStage; count: number; value: number; probability: number; weighted: number };
export type WeightedPipeline = {
  total: number;
  rows: PipelineRow[];
  dealsWithoutValue: number;
  excludedStages: DealStage[];
};

/**
 * weighted pipeline = sum(deal value × stage probability)
 * prospecting 10%, negotiating 40%, contracted 80%. Delivery and paid carry no weight:
 * delivery work is tracked through invoices, and paid is realised revenue.
 * Always label as: "Estimate, not guaranteed income."
 */
export function weightedPipeline(deals: Deal[]): WeightedPipeline {
  const rows: PipelineRow[] = DEAL_STAGES.map((stage) => ({
    stage,
    count: 0,
    value: 0,
    probability: STAGE_PROBABILITY[stage],
    weighted: 0,
  }));
  let dealsWithoutValue = 0;
  for (const d of deals) {
    const row = rows.find((r) => r.stage === d.stage);
    if (!row) continue;
    row.count += 1;
    if (d.value === null || d.value === undefined || !Number.isFinite(Number(d.value))) {
      dealsWithoutValue += 1;
      continue;
    }
    row.value += Number(d.value);
    row.weighted += Number(d.value) * row.probability;
  }
  const total = rows.reduce((sum, r) => sum + r.weighted, 0);
  return {
    total,
    rows,
    dealsWithoutValue,
    excludedStages: DEAL_STAGES.filter((s) => STAGE_PROBABILITY[s] === 0),
  };
}
