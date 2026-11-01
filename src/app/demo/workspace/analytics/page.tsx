import type { Metadata } from 'next';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate, formatNumber, formatPct } from '@/lib/format';
import { engagementRate } from '@/lib/metrics';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Analytics · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoAnalyticsPage() {
  const { remainingMs, view } = await loadDemoPage('/demo/workspace/analytics');
  const { data, analytics } = view;
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader title="Analytics" description="Sample numbers. In a real workspace these come from your connected YouTube and Instagram accounts, or from numbers you log. PBOS never estimates a missing figure." />
      <StatStrip className="mb-8" stats={[
        { label: 'Posts', value: formatNumber(analytics.totalPosts) },
        { label: 'With metrics', value: formatNumber(analytics.totalPosts - analytics.unmeasured.length) },
        { label: 'Average engagement', value: analytics.avgRate === null ? 'Not enough data' : formatPct(analytics.avgRate) },
        { label: 'Best format', value: analytics.bestFormat ? analytics.bestFormat.key : 'Not enough data', hint: analytics.bestFormat ? formatPct(analytics.bestFormat.avgRate) : undefined },
      ]} />
      <Section title="Posts" description="A post with no numbers is shown as “Not logged”, never as zero.">
        <Table aria-label="Sample posts">
          <THead><TR><TH>Post</TH><TH className="text-right">Views</TH><TH className="text-right">Engagement</TH></TR></THead>
          <TBody>
            {data.posts.map((p) => { const r = engagementRate(p); return (
              <TR key={p.id}><TD>{[p.platform, p.format].filter(Boolean).join(' · ')} <span className="text-muted-foreground">· {formatDate(p.published_at)}</span></TD><TD className="tabular text-right">{p.views === null ? 'Not logged' : formatNumber(p.views)}</TD><TD className="tabular text-right">{r === null ? 'Needs views' : formatPct(r)}</TD></TR>
            ); })}
          </TBody>
        </Table>
      </Section>
    </DemoShell>
  );
}
