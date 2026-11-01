import type { Metadata } from 'next';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { daysOverdue, effectiveStatus, revenueTotals } from '@/lib/revenue';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Revenue · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoRevenuePage() {
  const { remainingMs, now, view } = await loadDemoPage('/demo/workspace/revenue');
  const { data } = view;
  const totals = revenueTotals(data.revenue, now);
  const dealName = (id: string | null) => data.deals.find((d) => d.id === id)?.brand ?? 'No linked deal';
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader title="Revenue" description="Invoices you track, what has been collected and what is overdue. PBOS does not issue invoices or collect money: you mark an invoice paid yourself." />
      <StatStrip className="mb-8" stats={totals.flatMap((t) => [
        { label: `Collected (${t.currency})`, value: formatMoney(t.collected, t.currency) },
        { label: `Outstanding (${t.currency})`, value: formatMoney(t.outstanding, t.currency) },
        { label: `Overdue (${t.currency})`, value: formatMoney(t.overdue, t.currency) },
      ])} />
      <Section title="Invoices" description="Sample invoices for an invented creator.">
        <Table aria-label="Sample invoices">
          <THead><TR><TH>Brand</TH><TH className="text-right">Amount</TH><TH>Due</TH><TH>Status</TH></TR></THead>
          <TBody>
            {data.revenue.map((e) => { const s = effectiveStatus(e, now); return (
              <TR key={e.id}><TD>{dealName(e.deal_id)}</TD><TD className="tabular text-right">{formatMoney(Number(e.amount), e.currency)}</TD><TD>{formatDate(e.due_date)}</TD><TD><Badge variant={s === 'paid' ? 'success' : s === 'overdue' ? 'destructive' : 'secondary'}>{s === 'overdue' ? `Overdue ${daysOverdue(e, now)} days` : s}</Badge></TD></TR>
            ); })}
          </TBody>
        </Table>
      </Section>
    </DemoShell>
  );
}
