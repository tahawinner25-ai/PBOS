import { MIN_POSTS_FOR_PATTERN } from './constants';
import { formatPct, plural, truncate } from './format';
import type { Post } from './types';

export const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'saves', 'clicks'] as const;
type MetricPost = Pick<Post, (typeof METRIC_FIELDS)[number]>;

export function hasAnyMetric(p: MetricPost): boolean {
  return METRIC_FIELDS.some((f) => p[f] !== null && p[f] !== undefined);
}

/**
 * Engagement rate = (likes + comments + shares + saves) / views.
 * Returns null when views are missing or zero, because a rate cannot be computed
 * honestly without a denominator. Clicks are tracked separately and excluded.
 */
export function engagementRate(p: MetricPost): number | null {
  if (p.views === null || p.views === undefined || p.views <= 0) return null;
  const interactions = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saves ?? 0);
  return interactions / p.views;
}

export type GroupStat = { key: string; posts: number; avgRate: number; postIds: string[] };

function groupStats(posts: Post[], keyOf: (p: Post) => string | null): GroupStat[] {
  const map = new Map<string, { rates: number[]; ids: string[] }>();
  for (const p of posts) {
    const rate = engagementRate(p);
    const key = keyOf(p);
    if (rate === null || !key) continue;
    const g = map.get(key) ?? { rates: [], ids: [] };
    g.rates.push(rate);
    g.ids.push(p.id);
    map.set(key, g);
  }
  return Array.from(map.entries())
    .map(([key, g]) => ({
      key,
      posts: g.rates.length,
      avgRate: g.rates.reduce((a, b) => a + b, 0) / g.rates.length,
      postIds: g.ids,
    }))
    .sort((a, b) => b.avgRate - a.avgRate || b.posts - a.posts);
}

export type Insight = {
  id: string;
  title: string;
  detail: string;
  recommendation: string;
  source_record_ids: string[];
};

export type AnalyticsSummary = {
  totalPosts: number;
  unmeasured: Post[];
  partial: Post[];
  ratePosts: number;
  avgRate: number | null;
  byFormat: GroupStat[];
  byPlatform: GroupStat[];
  bestFormat: GroupStat | null;
  bestPlatform: GroupStat | null;
  sufficient: boolean;
  needs: string[];
  insights: Insight[];
};

export function summarizeAnalytics(posts: Post[]): AnalyticsSummary {
  const unmeasured = posts.filter((p) => !hasAnyMetric(p));
  const rated = posts.filter((p) => engagementRate(p) !== null);
  const partial = posts.filter((p) => hasAnyMetric(p) && engagementRate(p) === null);

  const rates = rated.map((p) => engagementRate(p) as number);
  const avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;

  const byFormat = groupStats(posts, (p) => p.format);
  const byPlatform = groupStats(posts, (p) => p.platform);

  const enough = rated.length >= MIN_POSTS_FOR_PATTERN;
  const bestFormat = enough && byFormat.length >= 2 ? byFormat[0] : null;
  const bestPlatform = enough && byPlatform.length >= 2 ? byPlatform[0] : null;

  const needs: string[] = [];
  if (unmeasured.length > 0) {
    needs.push(`Log metrics for ${plural(unmeasured.length, 'unmeasured post')}. Start with the oldest.`);
  }
  if (partial.length > 0) {
    needs.push(`Add view counts to ${plural(partial.length, 'post')}. Engagement rate needs views as the denominator.`);
  }
  if (!enough) {
    const gap = MIN_POSTS_FOR_PATTERN - rated.length;
    needs.push(
      `Log views and interactions for ${plural(gap, 'more post')} (${MIN_POSTS_FOR_PATTERN} are needed before PBOS compares formats or platforms).`,
    );
  } else {
    if (byFormat.length < 2) needs.push('Publish in a second format so PBOS can compare formats.');
    if (byPlatform.length < 2) needs.push('Publish on a second platform so PBOS can compare platforms.');
  }

  const insights: Insight[] = [];

  if (bestFormat && byFormat.length >= 2) {
    const next = byFormat[1];
    insights.push({
      id: 'best-format',
      title: `${bestFormat.key} is your strongest format so far`,
      detail: `${bestFormat.key} averages ${formatPct(bestFormat.avgRate)} engagement across ${plural(bestFormat.posts, 'post')}. Next is ${next.key} at ${formatPct(next.avgRate)} across ${plural(next.posts, 'post')}.`,
      recommendation: `Queue your next idea as ${bestFormat.key}, then log its results. With ${plural(rated.length, 'measured post')} this is an early signal, not a rule.`,
      source_record_ids: bestFormat.postIds.slice(0, 5),
    });
  }

  if (bestPlatform && byPlatform.length >= 2) {
    const next = byPlatform[1];
    insights.push({
      id: 'best-platform',
      title: `${bestPlatform.key} is your strongest platform so far`,
      detail: `${bestPlatform.key} averages ${formatPct(bestPlatform.avgRate)} engagement across ${plural(bestPlatform.posts, 'post')}. Next is ${next.key} at ${formatPct(next.avgRate)} across ${plural(next.posts, 'post')}.`,
      recommendation: `Write your next platform-specific angle for ${bestPlatform.key} first, and keep logging ${next.key} so the comparison stays honest.`,
      source_record_ids: bestPlatform.postIds.slice(0, 5),
    });
  }

  if (avgRate !== null) {
    const below = rated
      .filter((p) => (engagementRate(p) as number) < avgRate)
      .sort((a, b) => (engagementRate(a) as number) - (engagementRate(b) as number));
    const lowest = below[0];
    insights.push({
      id: 'avg-rate',
      title: `Average engagement rate is ${formatPct(avgRate)}`,
      detail: `This is the mean of per-post rates across ${plural(rated.length, 'post')} with views logged (interactions ÷ views).`,
      recommendation: lowest
        ? `Use ${formatPct(avgRate)} as your baseline. Review the hook on your lowest post (${truncate(lowest.notes || lowest.platform || 'untitled', 40)}) before reusing its angle.`
        : `Use ${formatPct(avgRate)} as your baseline and compare each new post against it.`,
      source_record_ids: rated.slice(0, 5).map((p) => p.id),
    });
  }

  return {
    totalPosts: posts.length,
    unmeasured,
    partial,
    ratePosts: rated.length,
    avgRate,
    byFormat,
    byPlatform,
    bestFormat,
    bestPlatform,
    sufficient: enough,
    needs,
    insights,
  };
}
