import type { Metadata } from 'next';
import { CalendarClock, Check, ShieldCheck, TrendingDown } from 'lucide-react';
import { BillingActions } from '@/components/billing-actions';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { requireCreator } from '@/lib/auth';
import { MAX_STEP, MONTHS_PER_STEP, formatUsd, isActiveStatus, monthsUntilDrop, scheduleRows, stepCents } from '@/lib/billing';
import { stripeConfigured } from '@/lib/server/stripe';
import { FEATURES, FEATURE_IDS, LIMITS, MAX_PRICE_CENTS, PLAN_NAMES, type PlanId } from '@/lib/plans';
import { usageSummary } from '@/lib/server/allowance';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Billing' };
export const dynamic = 'force-dynamic';

type Sub = { status: string; plan: string; price_step: number; periods_paid: number; current_period_end: string | null; cancel_at_period_end: boolean };

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : 'the next billing date');

export default async function BillingPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await searchParamsPromise;
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { data, error } = await ctx.supabase.from('subscriptions').select('status, plan, price_step, periods_paid, current_period_end, cancel_at_period_end').eq('creator_id', ctx.profile.id).maybeSingle();
  if (error) throw new Error(`billing: ${error.code}`);
  const sub = data as Sub | null;
  const active = sub ? isActiveStatus(sub.status) : false;
  const configured = stripeConfigured();
  const next = sub ? monthsUntilDrop(sub.periods_paid) : null;
  const rows = scheduleRows();
  const currentStep = sub && active ? sub.price_step : 0;
  const paidInStep = sub ? sub.periods_paid % MONTHS_PER_STEP : 0;
  const plan: PlanId = sub && active ? (sub.plan === 'max' ? 'max' : 'pro') : 'free';
  const admin = createAdminClient();
  const usage = admin ? await usageSummary(admin, ctx.profile.id) : null;
  const limitText = (n: number | null, period: string) => (n === null ? 'No limit' : `${n} a ${period}`);

  return (
    <>
      <PageHeader title="Billing" description={`Free, Pro and Max all include every feature; they differ in how much you can use each week or month. PBOS Pro starts at ${formatUsd(stepCents(0))} a month and gets cheaper: every ${MONTHS_PER_STEP} months you have paid, your price drops by $0.25, until it reaches ${formatUsd(stepCents(MAX_STEP))}. Cancel any time.`} />

      {searchParams.status === 'success' ? <Alert variant="success" title="Thank you" className="mb-6">Your payment went through. It can take a minute for this page to show the new plan. Refresh if it does not appear.</Alert> : null}
      {searchParams.status === 'upgraded' ? <Alert variant="success" title="You are on Max" className="mb-6">Your limits are lifted. It can take a minute for everything on this page to update.</Alert> : null}
      {searchParams.status === 'cancelled' ? <Alert variant="info" title="Checkout was cancelled" className="mb-6">Nothing was charged.</Alert> : null}
      {!configured ? <Alert variant="warning" title="Payments are not switched on yet" className="mb-6">The site operator needs to add the Stripe keys before anyone can subscribe.</Alert> : null}

      <div className="mb-12 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="plan-heading" className="surface relative overflow-hidden p-6 sm:p-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-primary/20 blur-3xl" />
          <div className="relative">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="plan-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Your plan</h2>
              {sub && active ? <Badge variant={sub.cancel_at_period_end ? 'warning' : 'success'}>{sub.cancel_at_period_end ? 'Ends soon' : `${PLAN_NAMES[plan]} · Active`}</Badge> : <Badge variant="outline">Free</Badge>}
            </div>

            {sub && active ? (
              <>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-gradient tabular text-6xl font-semibold tracking-tight">{plan === 'max' ? formatUsd(MAX_PRICE_CENTS) : formatUsd(stepCents(sub.price_step))}</span>
                  <span className="text-muted-foreground">a month · PBOS {PLAN_NAMES[plan]}</span>
                </p>
                <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                  <CalendarClock aria-hidden="true" className="size-4" />
                  {sub.cancel_at_period_end ? 'Cancelled. It stays active until ' : 'Renews on '}{date(sub.current_period_end)}.
                </p>

                {plan === 'pro' ? (
                <div className="mt-6 rounded-lg border border-border bg-background/40 p-4">
                  {next === null ? (
                    <p className="flex items-center gap-2 text-sm"><TrendingDown aria-hidden="true" className="size-4 text-success" />You are at the lowest price, {formatUsd(stepCents(MAX_STEP))}.</p>
                  ) : (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                        <span className="flex items-center gap-2"><TrendingDown aria-hidden="true" className="size-4 text-primary" />Next drop to {formatUsd(stepCents(sub.price_step + 1))}</span>
                        <span className="tabular text-muted-foreground">in {next} paid month{next === 1 ? '' : 's'}</span>
                      </div>
                      <div role="progressbar" aria-label="Paid months toward your next price drop" aria-valuemin={0} aria-valuemax={MONTHS_PER_STEP} aria-valuenow={paidInStep} className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-gradient-to-r from-primary to-[hsl(217_95%_68%)]" style={{ width: `${(paidInStep / MONTHS_PER_STEP) * 100}%` }} />
                      </div>
                      <p className="tabular mt-2 text-xs text-muted-foreground">{sub.periods_paid} month{sub.periods_paid === 1 ? '' : 's'} paid so far.</p>
                    </>
                  )}
                </div>
                ) : <p className="mt-6 text-sm text-muted-foreground">Max is a fixed price with no weekly or monthly usage limits.</p>}
                <div className="mt-6 flex flex-wrap items-start gap-3">
                  <BillingActions mode="portal" label="Manage billing or cancel" variant="outline" />
                  {plan === 'pro' && configured ? <BillingActions mode="upgrade" plan="max" label={`Upgrade to Max, ${formatUsd(MAX_PRICE_CENTS)} a month`} confirmText={`Upgrade to PBOS Max for ${formatUsd(MAX_PRICE_CENTS)} a month? Stripe charges the difference for the rest of this billing period to the card you already use.`} /> : null}
                </div>
              </>
            ) : (
              <>
                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-gradient tabular text-6xl font-semibold tracking-tight">{formatUsd(stepCents(0))}</span>
                  <span className="text-muted-foreground">a month · PBOS Pro</span>
                </p>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
                  {sub ? `Your last plan is ${sub.status.replace('_', ' ')}. ` : 'You are on the free plan. '}
                  Every feature works on the free plan, with small weekly and monthly limits. Pro raises them, and Max removes them.
                </p>
                <div className="mt-6 flex flex-wrap items-start gap-3">
                  {configured ? <BillingActions mode="checkout" plan="pro" label={`Subscribe to Pro, ${formatUsd(stepCents(0))} a month`} /> : null}
                  {configured ? <BillingActions mode="checkout" plan="max" variant="outline" label={`Subscribe to Max, ${formatUsd(MAX_PRICE_CENTS)} a month`} /> : null}
                  {sub ? <BillingActions mode="portal" label="Open billing history" /> : null}
                </div>
              </>
            )}
          </div>
        </section>

        <section aria-labelledby="how-heading" className="surface p-6">
          <h2 id="how-heading" className="text-sm font-medium uppercase tracking-wide text-muted-foreground">How it works</h2>
          <ul className="mt-4 space-y-4 text-sm">
            <li className="flex gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /><span><strong className="font-medium">Cheaper the longer you stay.</strong> $0.25 off every {MONTHS_PER_STEP} paid months, down to {formatUsd(stepCents(MAX_STEP))}.</span></li>
            <li className="flex gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /><span><strong className="font-medium">Counted in paid months,</strong> not by the calendar.</span></li>
            <li className="flex gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /><span><strong className="font-medium">Cancel any time</strong> from the billing portal. You keep access until the period ends.</span></li>
            <li className="flex gap-3"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span><strong className="font-medium">Card details stay with Stripe.</strong> PBOS never sees or stores them.</span></li>
          </ul>
        </section>
      </div>

      <Section title="Plans" description="Every plan includes every feature. Limits count per week (Monday to Sunday) or per calendar month, in UTC.">
        <div className="grid gap-4 md:grid-cols-3">
          {([['free', 'Free', '$0', 'No card needed.'], ['pro', 'Pro', `from ${formatUsd(stepCents(0))}`, `a month, dropping to ${formatUsd(stepCents(MAX_STEP))}`], ['max', 'Max', formatUsd(MAX_PRICE_CENTS), 'a month, fixed. Unlocks everything.']] as const).map(([id, name, price, note]) => (
            <section key={id} aria-labelledby={`plan-${id}`} className={`surface p-5 ${plan === id ? 'ring-2 ring-primary' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <h3 id={`plan-${id}`} className="text-lg font-semibold">{name}</h3>
                {plan === id ? <Badge variant="success">Your plan</Badge> : null}
              </div>
              <p className="mt-2"><span className="text-gradient tabular text-3xl font-semibold">{price}</span> <span className="text-sm text-muted-foreground">{note}</span></p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {FEATURE_IDS.map((f) => (
                  <li key={f} className="flex justify-between gap-3"><span className="text-muted-foreground">{FEATURES[f].label}</span><span className="tabular font-medium">{limitText(LIMITS[id][f], FEATURES[f].period)}</span></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Small daily safety limits stay on for every plan, Max included. They exist to stop runaway costs and abuse, and a shared daily ceiling across all creators also applies. Max removes the weekly and monthly caps.</p>
      </Section>

      {usage ? (
        <Section title="Your usage" description={`What you have used on the ${PLAN_NAMES[usage.plan]} plan. Nothing here is estimated: it is counted from your own actions.`} className="mt-12">
          <div className="surface divide-y divide-border">
            {usage.rows.map((r) => {
              const pct = r.limit === null || r.limit === 0 ? 0 : Math.min(100, (r.used / r.limit) * 100);
              return (
                <div key={r.feature} className="p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">{r.label}</span>
                    <span className="tabular text-muted-foreground">{r.limit === null ? `${r.used} ${r.unit} this ${r.period} · no limit` : `${r.used} of ${r.limit} this ${r.period} · resets ${r.resetsOn}`}</span>
                  </div>
                  {r.limit !== null ? (
                    <div role="progressbar" aria-label={`${r.label} used this ${r.period}`} aria-valuemin={0} aria-valuemax={r.limit} aria-valuenow={Math.min(r.used, r.limit)} className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div className={`h-full rounded-full ${pct >= 100 ? 'bg-destructive' : 'bg-gradient-to-r from-primary to-[hsl(217_95%_68%)]'}`} style={{ width: `${pct}%` }} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </Section>
      ) : null}

      <Section title="The Pro price steps" className="mt-12" description={`Each step lasts ${MONTHS_PER_STEP} paid months. After ${MAX_STEP * MONTHS_PER_STEP} paid months you stay at ${formatUsd(stepCents(MAX_STEP))}.`}>
        <div className="surface p-5">
          <div className="flex h-40 items-end gap-1 sm:gap-1.5" aria-hidden="true">
            {rows.map((r) => (
              <div key={r.step} className="flex h-full flex-1 items-end">
                <div
                  title={`From paid month ${r.fromMonth}: ${formatUsd(r.cents)}`}
                  className={r.step === currentStep && sub && active ? 'w-full rounded-t bg-gradient-to-t from-primary to-[hsl(217_95%_68%)]' : 'w-full rounded-t bg-muted-foreground/25'}
                  style={{ height: `${(r.cents / stepCents(0)) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
            <span>Month 1 · {formatUsd(stepCents(0))}</span>
            <span>Month {MAX_STEP * MONTHS_PER_STEP + 1}+ · {formatUsd(stepCents(MAX_STEP))}</span>
          </div>

          <details className="group mt-5 border-t border-border pt-4">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Show the full table</summary>
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">PBOS Pro monthly price by paid month</caption>
                <thead className="bg-muted/60 text-left"><tr><th scope="col" className="px-3 py-2 font-medium">From paid month</th><th scope="col" className="px-3 py-2 font-medium">Price per month</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r) => (
                    <tr key={r.step} className={sub && active && r.step === sub.price_step ? 'bg-accent/50 font-medium' : undefined}>
                      <td className="tabular px-3 py-1.5">{r.fromMonth}</td>
                      <td className="tabular px-3 py-1.5">{formatUsd(r.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </Section>
    </>
  );
}
