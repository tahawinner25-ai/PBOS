/**
 * Plans and usage limits. Pure: no network, no secrets, so it is tested.
 *
 * Free, Pro and Max all have every feature. What differs is how much you can use. Each feature counts per week
 * (Monday 00:00 UTC to Sunday) or per calendar month (UTC). Max has no weekly or monthly cap; the small daily safety
 * caps that protect everyone stay on for every plan, because they exist to stop runaway costs and abuse.
 */

export type PlanId = 'free' | 'pro' | 'max';
export type Period = 'week' | 'month';

export type FeatureId = 'agent_run' | 'image' | 'scene_picture' | 'render' | 'email_send' | 'email_search' | 'yt_search' | 'web_search';

export type FeatureMeta = { label: string; unit: string; period: Period; provider: string; bucket: string };

/** Where each feature is counted in api_usage (the same rows the daily caps use). */
export const FEATURES: Record<FeatureId, FeatureMeta> = {
  agent_run: { label: 'Agent requests', unit: 'requests', period: 'month', provider: 'agent', bucket: 'run' },
  image: { label: 'AI images', unit: 'images', period: 'week', provider: 'image', bucket: 'generate' },
  scene_picture: { label: 'Video scene pictures', unit: 'pictures', period: 'week', provider: 'image', bucket: 'storyboard' },
  render: { label: 'Video renders by the agent', unit: 'renders', period: 'month', provider: 'agent', bucket: 'render' },
  email_send: { label: 'Emails sent', unit: 'emails', period: 'week', provider: 'gmail', bucket: 'send' },
  email_search: { label: 'Email searches by the agent', unit: 'searches', period: 'week', provider: 'gmail', bucket: 'search' },
  yt_search: { label: 'YouTube searches by the agent', unit: 'searches', period: 'week', provider: 'agent', bucket: 'ytsearch' },
  web_search: { label: 'Web searches by the agent', unit: 'searches', period: 'week', provider: 'agent', bucket: 'search' },
};

export const FEATURE_IDS = Object.keys(FEATURES) as FeatureId[];

/** null = no weekly or monthly cap. */
export const LIMITS: Record<PlanId, Record<FeatureId, number | null>> = {
  free: { agent_run: 10, image: 3, scene_picture: 6, render: 1, email_send: 3, email_search: 5, yt_search: 5, web_search: 5 },
  pro: { agent_run: 150, image: 40, scene_picture: 60, render: 10, email_send: 30, email_search: 60, yt_search: 50, web_search: 50 },
  max: { agent_run: null, image: null, scene_picture: null, render: null, email_send: null, email_search: null, yt_search: null, web_search: null },
};

export const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', pro: 'Pro', max: 'Max' };

export const MAX_PRICE_CENTS = 5000;
export const MAX_PRODUCT_ID = 'pbos_max';
export const MAX_LOOKUP_KEY = 'pbos_max_5000';

export const limitFor = (plan: PlanId, feature: FeatureId): number | null => LIMITS[plan][feature];

/** Start (inclusive, 'yyyy-mm-dd' UTC) of the window `now` falls in: Monday for a week, the 1st for a month. */
export function windowStartDay(period: Period, now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  else d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

/** The moment (UTC) the current window ends, i.e. when the count resets. */
export function windowResetAt(period: Period, now: Date): Date {
  const start = new Date(`${windowStartDay(period, now)}T00:00:00Z`);
  if (period === 'week') start.setUTCDate(start.getUTCDate() + 7);
  else start.setUTCMonth(start.getUTCMonth() + 1);
  return start;
}

export type Verdict = { allowed: true; used: number; limit: number | null } | { allowed: false; used: number; limit: number; message: string };

const when = (period: Period, now: Date) => windowResetAt(period, now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/** Decides from a count already read. `used` is what was used in the window BEFORE this action. */
export function judge(plan: PlanId, feature: FeatureId, used: number, now: Date): Verdict {
  const limit = limitFor(plan, feature);
  if (limit === null || used < limit) return { allowed: true, used, limit };
  const meta = FEATURES[feature];
  const upgrade = plan === 'free' ? ' Pro has higher limits, and Max has none.' : plan === 'pro' ? ' Max has no weekly or monthly limits.' : '';
  return { allowed: false, used, limit, message: `You have used all ${limit} ${meta.unit} on the ${PLAN_NAMES[plan]} plan this ${meta.period}. The count resets on ${when(meta.period, now)} (UTC).${upgrade}` };
}

export const isPlanId = (v: unknown): v is PlanId => v === 'free' || v === 'pro' || v === 'max';
