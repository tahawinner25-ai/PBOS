import type { Metadata } from 'next';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { DEAL_STAGES, FORECAST_LABEL } from '@/lib/constants';
import { formatMoney } from '@/lib/format';
import { weightedPipeline } from '@/lib/revenue';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Deals · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoDealsPage() {
  const { remainingMs, view } = await loadDemoPage('/demo/workspace/deals');
  const { deals } = view.data;
  const pipeline = weightedPipeline(deals);
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader title="Deals" description="Your brand-deal pipeline. PBOS flags a deal that has sat in one stage too long and drafts the follow-up for you to send." />
      <Section title="Pipeline" description="Sample deals for an invented creator.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {DEAL_STAGES.map((stage) => (
            <div key={stage}>
              <h3 className="mb-2 text-xs font-medium capitalize text-muted-foreground">{stage}</h3>
              <ul className="space-y-2">
                {deals.filter((d) => d.stage === stage).map((d) => (
                  <li key={d.id} className="rounded-md border border-border bg-card p-3 text-sm"><p className="font-medium">{d.brand}</p><p className="text-xs text-muted-foreground">{d.value === null ? 'No value entered' : formatMoney(Number(d.value))}</p></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">Weighted pipeline: <span className="tabular font-medium text-foreground">{formatMoney(pipeline.total)}</span>. {FORECAST_LABEL}</p>
      </Section>
    </DemoShell>
  );
}
