import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FEATURES, FEATURE_IDS, judge, limitFor, windowResetAt, windowStartDay, isPlanId, type FeatureId, type PlanId, type Verdict } from '@/lib/plans';
import { isActiveStatus } from '@/lib/billing';

/** The plan a creator is on right now: Pro or Max while the subscription is active, otherwise Free. */
export async function planOf(db: SupabaseClient, creatorId: string): Promise<PlanId> {
  const { data, error } = await db.from('subscriptions').select('status, plan').eq('creator_id', creatorId).maybeSingle();
  if (error || !data) return 'free';
  const row = data as { status: string; plan: string | null };
  if (!isActiveStatus(row.status)) return 'free';
  return isPlanId(row.plan) && row.plan !== 'free' ? row.plan : 'pro';
}

/** Units used by this creator for a feature since the start of its week or month. */
export async function usedThisWindow(db: SupabaseClient, creatorId: string, feature: FeatureId, now: Date): Promise<number | null> {
  const meta = FEATURES[feature];
  const { data, error } = await db.from('api_usage').select('units').eq('creator_id', creatorId).eq('provider', meta.provider).eq('bucket', meta.bucket).gte('day', windowStartDay(meta.period, now)).limit(400);
  if (error) { console.error('[allowance] could not read usage:', error.code); return null; }
  let total = 0;
  for (const r of (data ?? []) as Array<{ units?: unknown }>) { const n = Number(r.units); if (Number.isFinite(n) && n > 0) total += n; }
  return total;
}

/**
 * Checks the plan's weekly or monthly allowance BEFORE the work is done (and before the daily counter is bumped, so a
 * refused attempt is not counted). If usage cannot be read it fails open: the per-minute and daily caps still apply.
 */
export async function checkAllowance(db: SupabaseClient, creatorId: string, feature: FeatureId, now: Date = new Date()): Promise<Verdict> {
  const plan = await planOf(db, creatorId);
  if (limitFor(plan, feature) === null) return { allowed: true, used: 0, limit: null };
  const used = await usedThisWindow(db, creatorId, feature, now);
  if (used === null) return { allowed: true, used: 0, limit: limitFor(plan, feature) };
  return judge(plan, feature, used, now);
}

export type UsageRow = { feature: FeatureId; label: string; unit: string; period: 'week' | 'month'; used: number; limit: number | null; resetsOn: string };

/** Everything the Billing page shows: the plan and one row per feature. */
export async function usageSummary(db: SupabaseClient, creatorId: string, now: Date = new Date()): Promise<{ plan: PlanId; rows: UsageRow[] }> {
  const plan = await planOf(db, creatorId);
  const rows = await Promise.all(FEATURE_IDS.map(async (feature) => {
    const meta = FEATURES[feature];
    return { feature, label: meta.label, unit: meta.unit, period: meta.period, used: (await usedThisWindow(db, creatorId, feature, now)) ?? 0, limit: limitFor(plan, feature), resetsOn: windowResetAt(meta.period, now).toISOString().slice(0, 10) };
  }));
  return { plan, rows };
}
