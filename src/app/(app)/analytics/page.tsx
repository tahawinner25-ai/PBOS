import type { Metadata } from 'next';
import { AddPostForm } from '@/components/add-post-form';
import { DemoBadge } from '@/components/demo-badge';
import { EmptyState } from '@/components/empty-state';
import { MetricsForm } from '@/components/metrics-form';
import { PageHeader, Section } from '@/components/page-header';
import { PlatformStatsSection } from '@/components/platform-stats-section';
import { StatStrip } from '@/components/stat-strip';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requireCreator } from '@/lib/auth';
import { todayISO } from '@/lib/dates';
import { formatDate, formatNumber, formatPct, plural, timeAgo } from '@/lib/format';
import { platformsConfigured } from '@/lib/integrations/config';
import { instagramView, youtubeView, type StatPoint } from '@/lib/platform-stats';
import { engagementRate, hasAnyMetric, summarizeAnalytics, type GroupStat } from '@/lib/metrics';
import type { Idea, Post } from '@/lib/types';

export const metadata: Metadata = { title: 'Analytics' };
export const dynamic = 'force-dynamic';

function postLabel(p: Pick<Post, 'platform' | 'format' | 'title'>) {
  const base = [p.platform, p.format].filter(Boolean).join(' · ') || 'Post';
  return p.title ? `${base} · ${p.title.slice(0, 60)}` : base;
}

const isSynced = (p: Pick<Post, 'source'>) => p.source === 'youtube' || p.source === 'instagram';

function Breakdown({ title, rows }: { title: string; rows: GroupStat[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm">{title}</h3>
      <Table aria-label={title}>
        <THead>
          <TR>
            <TH>Name</TH>
            <TH className="text-right">Posts measured</TH>
            <TH className="text-right">Average engagement</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.key}>
              <TD>{r.key}</TD>
              <TD className="tabular text-right">{r.posts}</TD>
              <TD className="tabular text-right">{formatPct(r.avgRate)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

export default async function AnalyticsPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const since = new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10);
  const [postsRes, ideasRes, pointsRes, connRes] = await Promise.all([
    supabase.from('posts').select('*').eq('creator_id', profile.id).order('published_at', { ascending: false, nullsFirst: false }).limit(500),
    supabase.from('ideas').select('id, hook, platform, status').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(200),
    supabase.from('analytics_points').select('platform, scope, external_id, metric, kind, window_days, day, value, fetched_at').eq('creator_id', profile.id).eq('scope', 'account').gte('day', since).order('day', { ascending: false }).limit(3000),
    supabase.from('social_connections').select('platform, status').eq('creator_id', profile.id),
  ]);
  if (postsRes.error) throw new Error(`posts: ${postsRes.error.message}`);
  if (ideasRes.error) throw new Error(`ideas: ${ideasRes.error.message}`);
  if (pointsRes.error) throw new Error(`analytics_points: ${pointsRes.error.message}`);
  if (connRes.error) throw new Error(`social_connections: ${connRes.error.message}`);
  const points = (pointsRes.data ?? []) as unknown as StatPoint[];
  const conns = (connRes.data ?? []) as Array<{ platform: 'youtube' | 'instagram'; status: string }>;
  const platformViews = (['youtube', 'instagram'] as const).map((platform) => {
    const c = conns.find((x) => x.platform === platform) ?? null;
    return { view: platform === 'youtube' ? youtubeView(points) : instagramView(points), connected: Boolean(c), status: c?.status ?? null };
  });
  const cfg = platformsConfigured();
  const posts = (postsRes.data ?? []) as Post[];
  const ideas = (ideasRes.data ?? []) as Array<Pick<Idea, 'id' | 'hook' | 'platform' | 'status'>>;

  const summary = summarizeAnalytics(posts);
  const today = todayISO(new Date());
  const measured = posts.length - summary.unmeasured.length;
  const missing = [...summary.unmeasured].sort((a, b) => (a.published_at ?? a.created_at).localeCompare(b.published_at ?? b.created_at));
  const recent = posts.filter((p) => hasAnyMetric(p)).slice(0, 15);
  const linkable = ideas.filter((i) => i.status !== 'measured');

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Performance of your posts, using the numbers from each platform’s own analytics: pulled from your connected accounts, or logged by you. PBOS never estimates a missing figure."
      />

      <StatStrip
        className="mb-10"
        stats={[
          { label: 'Posts logged', value: formatNumber(summary.totalPosts) },
          { label: 'With metrics', value: formatNumber(measured), hint: summary.unmeasured.length > 0 ? `${plural(summary.unmeasured.length, 'post')} still to log` : undefined },
          {
            label: 'Average engagement',
            value: summary.avgRate === null ? 'Not enough data' : formatPct(summary.avgRate),
            hint: summary.avgRate === null ? 'Needs posts with views logged' : `Across ${plural(summary.ratePosts, 'post')}`,
          },
          { label: 'Best format', value: summary.bestFormat ? summary.bestFormat.key : 'Not enough data', hint: summary.bestFormat ? formatPct(summary.bestFormat.avgRate) : undefined },
        ]}
      />

      <Section id="accounts" title="From your accounts" description="Numbers PBOS pulled from YouTube and Instagram. Each block names its source and when it was last updated. Nothing here is estimated.">
        <PlatformStatsSection views={platformViews} now={new Date()} anyConfigured={cfg.youtube || cfg.instagram} />
      </Section>

      <Section id="missing" title="Posts missing metrics" description="Oldest first. Enter what the platform shows. Leave a field blank if you do not have it.">
        {posts.length === 0 ? (
          <EmptyState title="No posts logged yet">Add a post you have published below, then log its performance here.</EmptyState>
        ) : missing.length === 0 ? (
          <EmptyState title="Every post has metrics">Log new posts below as you publish them.</EmptyState>
        ) : (
          <ul className="ledger" aria-label="Posts missing metrics">
            {missing.map((p) => (
              <li key={p.id} className="py-3">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 rounded-md py-1 hover:bg-accent/40">
                    <span className="font-medium">{postLabel(p)}</span>
                    <span className="text-sm text-muted-foreground">{p.published_at ? `Published ${formatDate(p.published_at)}` : 'No publish date'}</span>
                    <DemoBadge show={p.is_demo} />
                    <span className="ml-auto text-sm text-primary group-open:hidden">Log metrics</span>
                    <span className="ml-auto hidden text-sm text-muted-foreground group-open:inline">Close</span>
                  </summary>
                  <div className="mt-3 rounded-lg border border-border bg-card/50 p-4">
                    {isSynced(p) ? <p className="text-sm text-muted-foreground">This post came from {p.source === 'youtube' ? 'YouTube' : 'Instagram'}, which has not returned numbers for it yet. They fill in on the next sync.</p> : <MetricsForm post={p} />}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="insights" title="What the data says" description="Every insight ends with an action. Early patterns are labelled as early.">
        {summary.insights.length > 0 ? (
          <ul className="ledger" aria-label="Insights">
            {summary.insights.map((i) => (
              <li key={i.id} className="space-y-1.5 py-4">
                <h3 className="font-serif text-lg">{i.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{i.detail}</p>
                <p className="text-sm leading-relaxed">
                  <span className="font-medium">Next: </span>
                  {i.recommendation}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="Not enough data for an insight yet">PBOS compares formats and platforms only after it has enough measured posts, so it never reports a pattern that is just noise.</EmptyState>
        )}

        {summary.needs.length > 0 ? (
          <div className="mt-6">
            <h3 className="mb-2 text-sm">Log next</h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {summary.needs.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Section>

      {summary.byFormat.length > 0 || summary.byPlatform.length > 0 ? (
        <Section id="breakdown" title="Formats and platforms" description="Average of per-post engagement rates (likes + comments + shares + saves, divided by views).">
          <div className="grid gap-8 lg:grid-cols-2">
            <Breakdown title="By format" rows={summary.byFormat} />
            <Breakdown title="By platform" rows={summary.byPlatform} />
          </div>
        </Section>
      ) : null}

      <Section id="recent" title="Recent posts with metrics">
        {recent.length === 0 ? (
          <EmptyState title="No measured posts yet">Once you log metrics, your latest posts appear here with their engagement rate.</EmptyState>
        ) : (
          <ul className="ledger" aria-label="Recent posts">
            {recent.map((p) => {
              const rate = engagementRate(p);
              return (
                <li key={p.id} className="py-3">
                  <details className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 rounded-md py-1 hover:bg-accent/40">
                      <span className="font-medium">{postLabel(p)}</span>
                      <span className="text-sm text-muted-foreground">{formatDate(p.published_at)}</span>
                      <DemoBadge show={p.is_demo} />
                      {isSynced(p) ? <Badge variant="outline">Synced from {p.source === 'youtube' ? 'YouTube' : 'Instagram'}</Badge> : null}
                      <span className="tabular ml-auto flex items-center gap-3 text-sm">
                        <span>{p.views === null ? 'Views not logged' : `${formatNumber(p.views)} views`}</span>
                        {rate === null ? <Badge variant="warning">Needs views</Badge> : <Badge variant="secondary">{formatPct(rate)}</Badge>}
                      </span>
                    </summary>
                    <div className="mt-3 rounded-lg border border-border bg-card/50 p-4">
                      {isSynced(p) ? (
                        <p className="text-sm text-muted-foreground">
                          These numbers come from {p.source === 'youtube' ? 'YouTube' : 'Instagram'}{p.metrics_synced_at ? ` and were updated ${timeAgo(p.metrics_synced_at, new Date())}` : ''}. They refresh on every sync, so they are not editable here.
                          {p.external_url ? <> <a className="underline" href={p.external_url} target="_blank" rel="noreferrer noopener">Open the post</a>.</> : null}
                        </p>
                      ) : (
                        <MetricsForm post={p} />
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="add" title="Add a post" description="Record a post you published somewhere PBOS is not connected to. Posts from connected YouTube and Instagram accounts appear on their own after a sync.">
        <div className="max-w-2xl">
          <AddPostForm ideas={linkable} today={today} />
        </div>
      </Section>
    </>
  );
}
