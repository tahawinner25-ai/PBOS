import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoRecommendation } from '@/components/demo-recommendation';
import { DemoShell } from '@/components/demo-shell';
import { DraftSheet } from '@/components/draft-sheet';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Badge } from '@/components/ui/badge';
import { resolveSource } from '@/lib/agent/sources';
import { formatMoney, formatNumber } from '@/lib/format';
import { revenueTotals, weightedPipeline } from '@/lib/revenue';
import { DEMO_SOURCE_HREF, loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Dashboard · PBOS demo', robots: { index: false, follow: false } };
// Evaluated on every request: the demo's expiry is checked here and in the middleware, never from a cache.
export const dynamic = 'force-dynamic';

export default async function DemoDashboardPage() {
  const { remainingMs, now, view } = await loadDemoPage('/demo/workspace');
  const { data, plan, analytics, draft } = view;
  const src = (ids: string[]) => ids.map((id) => { const r = resolveSource(id, data); return { label: r.label, anchor: DEMO_SOURCE_HREF[r.kind] }; });
  const pipeline = weightedPipeline(data.deals);
  const totals = revenueTotals(data.revenue, now);
  const open = data.revenue.filter((e) => e.status !== 'paid').length;

  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader title="Today, Alex" description="Alex is an invented creator. This is what PBOS finds in Alex’s sample records, using the same checks as a real workspace. Nothing is saved." />

      <StatStrip className="mb-10" stats={[
        { label: 'Ideas', value: formatNumber(data.ideas.length), hint: <Link href="/demo/workspace/ideas" className="underline">Ideation</Link> },
        { label: 'Posts tracked', value: formatNumber(analytics.totalPosts), hint: <Link href="/demo/workspace/analytics" className="underline">Analytics</Link> },
        { label: 'Open deals', value: formatNumber(data.deals.filter((d) => d.stage !== 'paid').length), hint: <Link href="/demo/workspace/deals" className="underline">Deals</Link> },
        { label: 'Unpaid invoices', value: formatNumber(open), hint: <Link href="/demo/workspace/revenue" className="underline">Revenue</Link> },
      ]} />

      <Section title="What PBOS found" description="Flags are facts from the records. Recommendations are ranked, and each one says why and which records it comes from.">
        <ul className="ledger" aria-label="Flags">
          {plan.flags.map((f) => (
            <li key={f.key} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <Badge variant="outline" className="shrink-0">{f.pillar}</Badge>
              <span className="min-w-0 flex-1 leading-relaxed">{f.message}</span>
            </li>
          ))}
        </ul>
        <h3 className="mb-1 mt-8 text-base">Recommended next actions</h3>
        <ol className="ledger" aria-label="Recommendations">
          {plan.top.map((c) => <DemoRecommendation key={c.key} pillar={c.pillar} action={c.action} reason={c.reason} sources={src(c.source_record_ids)} />)}
        </ol>
      </Section>

      <Section title="Drafted for you" description="The assistant writes the next asset. You read it, edit it and send it yourself.">
        {draft ? (
          <DraftSheet title={draft.title} subject={draft.subject} body={draft.body} source="template" meta="Built from the sample invoice. In a real workspace the AI writes this in your voice, and you send it yourself.">
            <p className="text-xs text-paper-foreground/75">PBOS never sends anything for you.</p>
          </DraftSheet>
        ) : <EmptyState title="No draft today">Today’s findings do not call for a draft.</EmptyState>}
      </Section>

      <Section title="At a glance">
        <p className="text-sm text-muted-foreground">
          Weighted pipeline: <span className="tabular font-medium text-foreground">{formatMoney(pipeline.total)}</span> (estimate, not guaranteed income).{' '}
          {totals.length > 0 ? <>Outstanding: <span className="tabular font-medium text-foreground">{totals.map((t) => formatMoney(t.outstanding, t.currency)).join(', ')}</span>.</> : null}
        </p>
      </Section>
    </DemoShell>
  );
}
