import type { Metadata } from 'next';
import { DemoBadge } from '@/components/demo-badge';
import { EmptyState } from '@/components/empty-state';
import { InvoiceActions } from '@/components/invoice-actions';
import { InvoiceForm } from '@/components/invoice-form';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requireCreator } from '@/lib/auth';
import { DEFAULT_CURRENCY, FORECAST_LABEL, STAGE_LABEL } from '@/lib/constants';
import { formatDate, formatMoney, formatPct, plural } from '@/lib/format';
import { daysOverdue, effectiveStatus, revenueTotals, weightedPipeline, type EffectiveStatus } from '@/lib/revenue';
import type { Deal, RevenueEntry } from '@/lib/types';

export const metadata: Metadata = { title: 'Revenue' };

const STATUS_BADGE: Record<EffectiveStatus, { label: string; variant: 'success' | 'destructive' | 'secondary' }> = {
  paid: { label: 'Paid', variant: 'success' },
  overdue: { label: 'Overdue', variant: 'destructive' },
  invoiced: { label: 'Invoiced', variant: 'secondary' },
};

export default async function RevenuePage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const [entriesRes, dealsRes] = await Promise.all([
    supabase.from('revenue_entries').select('*').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(500),
    supabase.from('deals').select('*').eq('creator_id', profile.id).limit(500),
  ]);
  if (entriesRes.error) throw new Error(`revenue_entries: ${entriesRes.error.message}`);
  if (dealsRes.error) throw new Error(`deals: ${dealsRes.error.message}`);

  const now = new Date();
  const entries = (entriesRes.data ?? []) as RevenueEntry[];
  const deals = (dealsRes.data ?? []) as Deal[];
  const brandOf = new Map(deals.map((d) => [d.id, d.brand]));
  const currency = profile.rate_card?.[0]?.currency || DEFAULT_CURRENCY;

  const totals = revenueTotals(entries, now);
  const pipeline = weightedPipeline(deals);
  const hasPipelineValues = pipeline.rows.some((r) => r.value > 0);

  // Unpaid first (overdue, then by due date), paid last.
  const rank = (e: RevenueEntry) => {
    const s = effectiveStatus(e, now);
    return s === 'overdue' ? 0 : s === 'invoiced' ? 1 : 2;
  };
  const sorted = [...entries].sort((a, b) => rank(a) - rank(b) || (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const overdueCount = entries.filter((e) => effectiveStatus(e, now) === 'overdue').length;

  return (
    <>
      <PageHeader
        title="Revenue"
        description="Invoices you enter by hand, and a forecast from your open deals. PBOS tracks and drafts; it does not issue invoices, send reminders or collect payment."
      />

      <Section id="totals" title="Totals">
        {totals.length === 0 ? (
          <EmptyState title="No invoices yet">Add an invoice below to see what you have collected, what is outstanding and what is overdue.</EmptyState>
        ) : (
          <div className="space-y-6">
            {totals.map((t) => (
              <div key={t.currency}>
                {totals.length > 1 ? <h3 className="mb-2 text-sm">{t.currency}</h3> : null}
                <StatStrip
                  stats={[
                    { label: 'Collected', value: formatMoney(t.collected, t.currency) },
                    { label: 'Outstanding', value: formatMoney(t.outstanding, t.currency), hint: 'Everything unpaid, including overdue' },
                    { label: 'Overdue', value: formatMoney(t.overdue, t.currency), hint: t.overdue > 0 ? 'Past its due date' : 'Nothing past due' },
                  ]}
                  className="sm:grid-cols-3"
                />
              </div>
            ))}
            {totals.length > 1 ? <p className="text-xs text-muted-foreground">Amounts in different currencies are never added together.</p> : null}
          </div>
        )}
      </Section>

      <Section
        id="pipeline"
        title="Weighted pipeline"
        description="Open deal values multiplied by a fixed probability for each stage: prospecting 10%, negotiating 40%, contracted 80%. Delivery and paid are not counted."
      >
        {!hasPipelineValues ? (
          <EmptyState title="No deal values yet">Add a value to your deals and PBOS will weight them here. Deals without a value are not counted.</EmptyState>
        ) : (
          <div className="space-y-4">
            <p className="tabular font-serif text-3xl">{formatMoney(pipeline.total, currency)}</p>
            <Alert variant="warning" title={FORECAST_LABEL}>
              The probabilities are fixed assumptions, not predictions about any brand. Deal values have no currency of their own, so they are shown in {currency}, taken from your rate card.
            </Alert>
            <Table aria-label="Weighted pipeline by stage">
              <THead>
                <TR>
                  <TH>Stage</TH>
                  <TH className="text-right">Deals</TH>
                  <TH className="text-right">Value</TH>
                  <TH className="text-right">Probability used</TH>
                  <TH className="text-right">Weighted</TH>
                </TR>
              </THead>
              <TBody>
                {pipeline.rows.map((r) => (
                  <TR key={r.stage}>
                    <TD>{STAGE_LABEL[r.stage]}</TD>
                    <TD className="tabular text-right">{r.count}</TD>
                    <TD className="tabular text-right">{formatMoney(r.value, currency)}</TD>
                    <TD className="tabular text-right">{r.probability > 0 ? formatPct(r.probability, 0) : 'Not counted'}</TD>
                    <TD className="tabular text-right">{r.probability > 0 ? formatMoney(r.weighted, currency) : '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {pipeline.dealsWithoutValue > 0 ? (
              <p className="text-sm text-muted-foreground">{plural(pipeline.dealsWithoutValue, 'deal')} without a value {pipeline.dealsWithoutValue === 1 ? 'is' : 'are'} not included.</p>
            ) : null}
          </div>
        )}
      </Section>

      <Section
        id="invoices"
        title="Invoices"
        description={overdueCount > 0 ? `${plural(overdueCount, 'invoice')} overdue. Draft follow-ups, from friendly to firm, and send them yourself.` : 'Unpaid invoices first.'}
      >
        {sorted.length === 0 ? (
          <EmptyState title="No invoices yet">Record an invoice you issued and PBOS will watch its due date.</EmptyState>
        ) : (
          <ul className="ledger" aria-label="Invoices">
            {sorted.map((e) => {
              const status = effectiveStatus(e, now);
              const late = daysOverdue(e, now);
              const brand = e.deal_id ? (brandOf.get(e.deal_id) ?? null) : null;
              const badge = STATUS_BADGE[status];
              return (
                <li key={e.id} className="space-y-3 py-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="font-medium">{brand ?? 'No linked deal'}</span>
                    <span className="tabular font-serif text-lg">{formatMoney(Number(e.amount), e.currency)}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    <DemoBadge show={e.is_demo} />
                    <span className="tabular ml-auto text-sm text-muted-foreground">
                      {status === 'paid'
                        ? `Paid ${formatDate(e.paid_at)}`
                        : e.due_date
                          ? status === 'overdue' && late > 0
                            ? `Due ${formatDate(e.due_date)} · ${plural(late, 'day')} late`
                            : `Due ${formatDate(e.due_date)}`
                          : 'No due date'}
                    </span>
                  </div>
                  {e.notes ? <p className="text-sm text-muted-foreground">{e.notes}</p> : null}
                  <InvoiceActions invoiceId={e.id} paid={status === 'paid'} overdue={status === 'overdue'} brand={brand} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section id="add" title="Add an invoice" description="Enter the invoice details yourself. Set a due date so PBOS can tell when it is late.">
        <div className="max-w-2xl">
          <InvoiceForm deals={deals.map((d) => ({ id: d.id, brand: d.brand }))} defaultCurrency={currency} />
        </div>
      </Section>
    </>
  );
}
