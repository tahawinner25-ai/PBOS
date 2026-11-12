import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A shared daily ceiling on everything that can cost money or burn a free quota (images, agent runs), added up across
 * ALL creators. Each creator already has their own daily allowance; this stops many creators together from running up
 * a bill or exhausting a free provider. Set PBOS_GLOBAL_DAILY_LIMIT (units per UTC day, default 3000; 0 turns it off).
 * The total is read at most once a minute per server instance, so it adds one small query a minute, not one per request.
 */
export function globalDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PBOS_GLOBAL_DAILY_LIMIT;
  if (raw === undefined || raw.trim() === '') return 3000;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 10_000_000 ? n : 3000;
}

export const GLOBAL_LIMIT_MESSAGE = 'PBOS has reached its shared free limit for today, across everyone. It resets at midnight UTC. Try again tomorrow.';

let cached: { day: string; at: number; total: number } | null = null;
const TTL_MS = 60_000;

/** Adds up a list of usage rows. Pure, so it can be tested. */
export function sumUnits(rows: ReadonlyArray<{ units?: unknown }> | null | undefined): number {
  let total = 0;
  for (const r of rows ?? []) { const n = Number(r.units); if (Number.isFinite(n) && n > 0) total += n; }
  return total;
}

/** True while today's shared total is under the ceiling. If the total cannot be read, it fails open (the per-creator limits still apply) and logs. */
export async function underGlobalLimit(admin: SupabaseClient, now: Date = new Date(), limit: number = globalDailyLimit()): Promise<boolean> {
  if (limit === 0) return true;
  const day = now.toISOString().slice(0, 10);
  if (cached && cached.day === day && now.getTime() - cached.at < TTL_MS) return cached.total < limit;
  const { data, error } = await admin.from('api_usage').select('units').eq('day', day).in('provider', ['image', 'agent']).limit(20_000);
  if (error) { console.error('[budget] could not read the shared total:', error.code); return true; }
  const total = sumUnits(data as Array<{ units?: unknown }>);
  cached = { day, at: now.getTime(), total };
  return total < limit;
}

export function resetBudgetCache(): void { cached = null; }
