export const DAY_MS = 86_400_000;

export function toDate(v: string | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** Milliseconds elapsed from `from` to `now` (negative when `from` is in the future). */
export function ageMs(from: string | Date, now: Date): number {
  return now.getTime() - toDate(from).getTime();
}

/** Whole days elapsed from `from` to `now`. Invalid dates yield 0. */
export function daysBetween(from: string | Date | null | undefined, now: Date): number {
  if (!from) return 0;
  const ms = ageMs(from, now);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / DAY_MS));
}

/** UTC calendar date as YYYY-MM-DD. */
export function todayISO(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days between two YYYY-MM-DD dates (b - a). */
export function isoDayDiff(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.round((db - da) / DAY_MS);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
