/**
 * Turns the rows PBOS synced from YouTube and Instagram (analytics_points) into the few figures the
 * Analytics page shows. Pure: no I/O, so the arithmetic is tested.
 *
 * Rules: a figure is shown only if the platform returned it; a total says how many days it covers; nothing
 * is extrapolated, averaged across missing days or filled in. Summing daily "reach" would double count
 * people, so reach is shown as a daily average and labelled that way.
 */

export type StatPlatform = 'youtube' | 'instagram';
export type StatPoint = {
  platform: StatPlatform;
  scope: 'account' | 'media';
  external_id: string;
  metric: string;
  kind: 'daily' | 'window' | 'current' | 'lifetime';
  window_days: number | null;
  day: string; // yyyy-mm-dd
  value: number;
  fetched_at: string;
};

export type DayValue = { day: string; value: number };
export type PlatformStat = { label: string; value: string; hint?: string };
export type PlatformView = {
  platform: StatPlatform;
  hasData: boolean;
  lastFetchedAt: string | null;
  stats: PlatformStat[];
  series: { label: string; days: DayValue[] } | null;
};

const num = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const num1 = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(n);

/** The account the newest data belongs to. If a creator reconnected a different channel, old rows are ignored. */
export function currentAccountId(points: StatPoint[], platform: StatPlatform): string | null {
  let best: StatPoint | null = null;
  for (const p of points) {
    if (p.platform !== platform || p.scope !== 'account') continue;
    if (!best || p.fetched_at > best.fetched_at) best = p;
  }
  return best ? best.external_id : null;
}

function accountPoints(points: StatPoint[], platform: StatPlatform): StatPoint[] {
  const id = currentAccountId(points, platform);
  return id === null ? [] : points.filter((p) => p.platform === platform && p.scope === 'account' && p.external_id === id);
}

export function latestCurrent(points: StatPoint[], platform: StatPlatform, metric: string): { value: number; day: string } | null {
  let best: StatPoint | null = null;
  for (const p of accountPoints(points, platform)) {
    if (p.metric === metric && p.kind === 'current' && (!best || p.day > best.day)) best = p;
  }
  return best ? { value: best.value, day: best.day } : null;
}

/** The newest 28-day total returned for a metric (Instagram "window" rows). */
export function latestWindow(points: StatPoint[], platform: StatPlatform, metric: string, windowDays: number): { value: number; day: string } | null {
  let best: StatPoint | null = null;
  for (const p of accountPoints(points, platform)) {
    if (p.metric === metric && p.kind === 'window' && p.window_days === windowDays && (!best || p.day > best.day)) best = p;
  }
  return best ? { value: best.value, day: best.day } : null;
}

/** Daily values for a metric, oldest first, one per day. */
export function dailySeries(points: StatPoint[], platform: StatPlatform, metric: string): DayValue[] {
  const byDay = new Map<string, number>();
  for (const p of accountPoints(points, platform)) if (p.metric === metric && p.kind === 'daily') byDay.set(p.day, p.value);
  return [...byDay.entries()].map(([day, value]) => ({ day, value })).sort((a, b) => a.day.localeCompare(b.day));
}

/** The last `days` calendar days of a series ending at its newest day. Returns only days the platform returned. */
export function lastDays(series: DayValue[], days: number): DayValue[] {
  if (series.length === 0) return [];
  const end = Date.parse(`${series[series.length - 1].day}T00:00:00Z`);
  const from = end - (days - 1) * 86_400_000;
  return series.filter((d) => Date.parse(`${d.day}T00:00:00Z`) >= from);
}

export function total(series: DayValue[]): { sum: number; days: number } | null {
  if (series.length === 0) return null;
  return { sum: series.reduce((a, d) => a + d.value, 0), days: series.length };
}

export function lastFetched(points: StatPoint[], platform: StatPlatform): string | null {
  let best: string | null = null;
  for (const p of accountPoints(points, platform)) if (!best || p.fetched_at > best) best = p.fetched_at;
  return best;
}

function covers(days: number, wanted: number): string | undefined {
  return days >= wanted ? `Last ${wanted} days` : `${days} of the last ${wanted} days were returned`;
}

export function youtubeView(points: StatPoint[]): PlatformView {
  const views = lastDays(dailySeries(points, 'youtube', 'views'), 28);
  const minutes = lastDays(dailySeries(points, 'youtube', 'estimatedMinutesWatched'), 28);
  const gained = lastDays(dailySeries(points, 'youtube', 'subscribersGained'), 28);
  const lost = lastDays(dailySeries(points, 'youtube', 'subscribersLost'), 28);
  const subs = latestCurrent(points, 'youtube', 'subscribers');
  const stats: PlatformStat[] = [];

  if (subs) stats.push({ label: 'Subscribers', value: num(subs.value), hint: `As of ${subs.day}` });
  const v = total(views);
  if (v) stats.push({ label: 'Views', value: num(v.sum), hint: covers(v.days, 28) });
  const m = total(minutes);
  if (m) stats.push({ label: 'Watch time (hours)', value: num1(m.sum / 60), hint: covers(m.days, 28) });
  const g = total(gained);
  const l = total(lost);
  if (g && l) {
    const days = Math.min(g.days, l.days);
    const net = g.sum - l.sum;
    stats.push({ label: 'Net subscribers', value: `${net > 0 ? '+' : ''}${num(net)}`, hint: `${num(g.sum)} gained, ${num(l.sum)} lost · ${covers(days, 28)}` });
  }
  return { platform: 'youtube', hasData: stats.length > 0 || views.length > 0, lastFetchedAt: lastFetched(points, 'youtube'), stats, series: views.length ? { label: 'Views per day', days: views } : null };
}

export function instagramView(points: StatPoint[]): PlatformView {
  const reach = lastDays(dailySeries(points, 'instagram', 'reach'), 28);
  const followers = latestCurrent(points, 'instagram', 'followers');
  const stats: PlatformStat[] = [];

  if (followers) stats.push({ label: 'Followers', value: num(followers.value), hint: `As of ${followers.day}` });
  const r = total(reach);
  if (r) stats.push({ label: 'Average daily reach', value: num(r.sum / r.days), hint: `Mean of ${r.days} daily values. Not a unique-people total.` });
  for (const [metric, label] of [['views', 'Views'], ['accounts_engaged', 'Accounts engaged'], ['total_interactions', 'Interactions'], ['profile_links_taps', 'Profile link taps']] as const) {
    const w = latestWindow(points, 'instagram', metric, 28);
    if (w) stats.push({ label, value: num(w.value), hint: `28 days to ${w.day}` });
  }
  return { platform: 'instagram', hasData: stats.length > 0, lastFetchedAt: lastFetched(points, 'instagram'), stats: stats.slice(0, 6), series: reach.length ? { label: 'Accounts reached per day', days: reach } : null };
}
