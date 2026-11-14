import type { Metadata } from 'next';
import { BillingActions } from '@/components/billing-actions';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { requireCreator } from '@/lib/auth';
import { MAX_STEP, MONTHS_PER_STEP, formatUsd, isActiveStatus, monthsUntilDrop, scheduleRows, stepCents } from '@/lib/billing';
import { stripeConfigured } from '@/lib/server/stripe';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

type Sub = { status: string; price_step: number; periods_paid: number; current_period_end: string | null; cancel_at_period_end: boolean };

export default async function BillingPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await searchParamsPromise;
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { data, error } = await ctx.supabase.from('subscriptions').select('status, price_step, periods_paid, current_period_end, cancel_at_period_end').eq('creator_id', ctx.profile.id).maybeSingle();
  if (error) throw new Error(`billing: ${error.code}`);
  const sub = data as Sub | null;
  const active = sub ? isActiveStatus(sub.status) : false;
  const configured = stripeConfigured();
  const next = sub ? monthsUntilDrop(sub.periods_paid) : null;

  return (
    <>
      <PageHeader title="Billing" description={`PBOS Pro starts at ${formatUsd(stepCents(0))} a month and gets cheaper: every ${MONTHS_PER_STEP} months you have paid, your price drops by $0.25, until it reaches ${formatUsd(stepCents(MAX_STEP))}. You can cancel at any time.`} />

      {searchParams.status === 'success' ? <Alert variant="success" title="Thank you" className="mb-6">Your payment went through. It can take a minute for this page to show the new plan. Refresh if it does not appear.</Alert> : null}
      {searchParams.status === 'cancelled' ? <Alert variant="info" title="Checkout was cancelled" className="mb-6">Nothing was charged.</Alert> : null}
      {!configured ? <Alert variant="warning" title="Payments are not switched on yet" className="mb-6">The site operator needs to add the Stripe keys before anyone can subscribe.</Alert> : null}

      <Section title="Your plan">
        <div className="rounded-lg border border-border bg-card p-5">
          {sub && active ? (
            <div className="space-y-2">
              <p className="font-medium">PBOS Pro · {formatUsd(stepCents(sub.price_step))} a month</p>
              <p className="text-sm text-muted-foreground">
                {sub.cancel_at_period_end ? 'Cancelled: it stays active until ' : 'Renews on '}
                {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'the next billing date'}.
              </p>
              <p className="text-sm text-muted-foreground">
                {next === null ? `You are at the lowest price, ${formatUsd(stepCents(MAX_STEP))}.` : `You have paid ${sub.periods_paid} month${sub.periods_paid === 1 ? '' : 's'}. Your price drops after ${next} more paid month${next === 1 ? '' : 's'}.`}
              </p>
              <div className="pt-2"><BillingActions mode="portal" label="Manage billing or cancel" /></div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="font-medium">{sub ? `Your last plan is ${sub.status.replace('_', ' ')}.` : 'You are on the free plan.'}</p>
              <p className="text-sm text-muted-foreground">Pro is {formatUsd(stepCents(0))} a month for your first {MONTHS_PER_STEP} months. Today, every PBOS feature is available on the free plan too; Pro supports the work on PBOS and does not unlock extra features yet. Payment is handled by Stripe.</p>
              {configured ? <BillingActions mode="checkout" label={`Subscribe for ${formatUsd(stepCents(0))} a month`} /> : null}
              {sub ? <BillingActions mode="portal" label="Open billing history" /> : null}
            </div>
          )}
        </div>
      </Section>

      <Section title="The price steps" description={`Counted in months you have actually paid, not by the calendar. Each step lasts ${MONTHS_PER_STEP} months. After ${MAX_STEP * MONTHS_PER_STEP} paid months you stay at ${formatUsd(stepCents(MAX_STEP))}.`}>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <caption className="sr-only">PBOS Pro monthly price by paid month</caption>
            <thead className="bg-muted/60 text-left"><tr><th scope="col" className="px-3 py-2 font-medium">From paid month</th><th scope="col" className="px-3 py-2 font-medium">Price per month</th></tr></thead>
            <tbody className="divide-y divide-border">
              {scheduleRows().map((r) => (
                <tr key={r.step} className={sub && active && r.step === sub.price_step ? 'bg-accent/50 font-medium' : undefined}>
                  <td className="px-3 py-1.5">{r.fromMonth}</td>
                  <td className="px-3 py-1.5">{formatUsd(r.cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
