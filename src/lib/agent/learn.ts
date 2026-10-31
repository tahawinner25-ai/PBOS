import { PILLARS, type Pillar } from '../constants';
import { DAY_MS, addDaysISO, todayISO } from '../dates';
import { truncate } from '../format';
import type { AgentEvent } from '../types';

export const IGNORE_WINDOW_DAYS = 14;
export const IGNORE_LIMIT = 2;
export const ACCEPT_COOLDOWN_DAYS = 2;
export const PILLAR_WINDOW_DAYS = 30;

export type Suppression = { reason: 'ignored' | 'accepted_recently'; resumes: string; note: string };
export type Feedback = {
  suppressed: Map<string, Suppression>;
  pillarAdjust: Record<Pillar, number>;
  notes: string[];
};

type Decision = { at: number; kind: 'accepted' | 'ignored'; key: string; pillar: Pillar | null; action: string };

function toDecision(e: AgentEvent): Decision | null {
  if (e.type !== 'accepted' && e.type !== 'ignored') return null;
  const key = typeof e.payload?.key === 'string' ? e.payload.key : null;
  if (!key) return null;
  const pillar = (PILLARS as readonly string[]).includes(String(e.pillar)) ? (e.pillar as Pillar) : null;
  const action = typeof e.payload?.action === 'string' ? e.payload.action : key;
  return { at: new Date(e.created_at).getTime(), kind: e.type, key, pillar, action };
}

/**
 * LEARN step. Reads accepted/ignored events and returns:
 * - suppressed keys: recommendations the creator ignored twice in 14 days stay paused (the flag still shows),
 *   and recently accepted ones get a 2-day grace period.
 * - pillar adjustments: accepted pillars rank higher, ignored ones lower.
 * Everything here is derived from real agent_events rows.
 */
export function analyzeFeedback(events: AgentEvent[], now: Date): Feedback {
  const decisions = events.map(toDecision).filter((d): d is Decision => d !== null);
  const nowMs = now.getTime();
  const suppressed = new Map<string, Suppression>();
  const notes: string[] = [];

  const byKey = new Map<string, Decision[]>();
  for (const d of decisions) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);

  byKey.forEach((list, key) => {
    list.sort((a, b) => a.at - b.at);
    const action = truncate(list[list.length - 1].action, 70);
    const accepts = list.filter((d) => d.kind === 'accepted');
    const lastAccept = accepts.length ? accepts[accepts.length - 1] : null;

    if (lastAccept && nowMs - lastAccept.at < ACCEPT_COOLDOWN_DAYS * DAY_MS) {
      const resumes = addDaysISO(todayISO(new Date(lastAccept.at)), ACCEPT_COOLDOWN_DAYS);
      const note = `You accepted "${action}" recently. PBOS gives it ${ACCEPT_COOLDOWN_DAYS} days and will raise it again after ${resumes} if the data has not changed.`;
      suppressed.set(key, { reason: 'accepted_recently', resumes, note });
      notes.push(note);
      return;
    }

    const windowStart = nowMs - IGNORE_WINDOW_DAYS * DAY_MS;
    const ignores = list
      .filter((d) => d.kind === 'ignored' && d.at >= windowStart && (!lastAccept || d.at > lastAccept.at))
      .sort((a, b) => b.at - a.at);
    if (ignores.length >= IGNORE_LIMIT) {
      const resumes = addDaysISO(todayISO(new Date(ignores[IGNORE_LIMIT - 1].at)), IGNORE_WINDOW_DAYS);
      const note = `You ignored "${action}" ${ignores.length} times in the last ${IGNORE_WINDOW_DAYS} days. It is paused until ${resumes}; the flag stays visible.`;
      suppressed.set(key, { reason: 'ignored', resumes, note });
      notes.push(note);
    }
  });

  const pillarAdjust = Object.fromEntries(PILLARS.map((p) => [p, 0])) as Record<Pillar, number>;
  const pillarStart = nowMs - PILLAR_WINDOW_DAYS * DAY_MS;
  for (const d of decisions) {
    if (!d.pillar || d.at < pillarStart) continue;
    pillarAdjust[d.pillar] += d.kind === 'accepted' ? 5 : -3;
  }
  for (const p of PILLARS) pillarAdjust[p] = Math.max(-9, Math.min(15, pillarAdjust[p]));

  for (const p of PILLARS) {
    if (pillarAdjust[p] > 0) notes.push(`You acted on ${p} suggestions recently, so ${p} items rank a little higher.`);
    if (pillarAdjust[p] < 0) notes.push(`You skipped ${p} suggestions recently, so ${p} items rank a little lower.`);
  }

  return { suppressed, pillarAdjust, notes };
}
