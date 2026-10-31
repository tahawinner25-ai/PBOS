import type { Metadata } from 'next';
import Link from 'next/link';
import { Brand } from '@/components/brand';
import { DemoRecommendation } from '@/components/demo-recommendation';
import { DemoTimer } from '@/components/demo-timer';
import { DraftSheet } from '@/components/draft-sheet';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { resolveSource } from '@/lib/agent/sources';
import { DEAL_STAGES, FORECAST_LABEL } from '@/lib/constants';
import { buildDemoView } from '@/lib/demo-workspace';
import { formatDate, formatMoney, formatNumber, formatPct } from '@/lib/format';
import { engagementRate } from '@/lib/metrics';
import { daysOverdue, effectiveStatus, revenueTotals, weightedPipeline } from '@/lib/revenue';
import { requireDemo } from '@/lib/server/demo';

export const metadata: Metadata = { title: 'PBOS demo', robots: { index: false, follow: false } };
// Evaluated on every request: the demo's expiry is checked here and in the middleware, never from a cache.
export const dynamic = 'force-dynamic';

const ANCHOR = { idea: '#ideas', post: '#analytics', deal: '#deals', invoice: '#revenue', profile: '#today', connection: '#today', publish: '#today', unknown: '#today' } as const;

export default async function DemoWorkspacePage() {
  const remainingMs = await requireDemo('/demo/workspace');
  const now = new Date();
  const { data, plan, analytics, draft } = buildDemoView(now);
  const src = (ids: string[]) => ids.map((id) => { const r = resolveSource(id, data); return { label: r.label, anchor: ANCHOR[r.kind] }; });
  const pipeline = weightedPipeline(data.deals);
  const totals = revenueTotals(data.revenue, now);
  const dealName = (id: string | null) => data.deals.find((d) => d.id === id)?.brand ?? 'No linked deal';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3"><Brand /><Badge variant="warning">Sample data</Badge></div>
          <DemoTimer remainingMs={remainingMs} />
          <div className="flex items-center gap-2">
            <Button asChild size="sm"><Link href="/signup">Create your workspace</Link></Button>
            <form method="post" action="/api/demo/end"><Button type="submit" size="sm" variant="ghost">End demo</Button></form>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <PageHeader title="Today, Alex" description="Alex is an invented creator. This is what PBOS finds in Alex’s sample records, using the same checks as a real workspace. Nothing is saved." />
        <nav aria-label="Demo sections" className="mb-8 flex flex-wrap gap-2 text-sm">
          {['today', 'ideas', 'analytics', 'deals', 'revenue', 'locked'].map((id) => <a key={id} href={`#${id}`} className="rounded-full border border-border px-3 py-1 capitalize text-muted-foreground hover:bg-accent/50">{id === 'locked' ? 'Not in the demo' : id}</a>)}
        </nav>

        <Section id="today" title="What PBOS found" description="Flags are facts from the records. Recommendations are ranked, and each one says why and which records it comes from.">
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
          <h3 className="mb-3 mt-8 text-base">Drafted for you</h3>
          {draft ? (
            <DraftSheet title={draft.title} subject={draft.subject} body={draft.body} source="template" meta="Built from the sample invoice. In a real workspace the AI writes this in your voice, and you send it yourself.">
              <p className="text-xs text-paper-foreground/75">PBOS never sends anything for you.</p>
            </DraftSheet>
          ) : <EmptyState title="No draft today">Today’s findings do not call for a draft.</EmptyState>}
        </Section>

        <Section id="ideas" title="Ideas" description="Sample idea bank. In a real workspace you can add, script, schedule and adapt ideas across platforms.">
          <ul className="ledger" aria-label="Ideas">
            {data.ideas.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <span className="min-w-0 flex-1 font-medium">{i.hook}</span>
                <span className="text-muted-foreground">{[i.platform, i.format].filter(Boolean).join(' · ')}</span>
                <Badge variant="secondary">{i.status}</Badge>
                {i.scheduled_for ? <span className="text-xs text-muted-foreground">Scheduled {formatDate(i.scheduled_for)}</span> : null}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="analytics" title="Analytics" description="Sample numbers. In a real workspace these come from your connected YouTube and Instagram accounts, or from numbers you log. PBOS never estimates a missing figure.">
          <StatStrip className="mb-6" stats={[
            { label: 'Posts', value: formatNumber(analytics.totalPosts) },
            { label: 'With metrics', value: formatNumber(analytics.totalPosts - analytics.unmeasured.length) },
            { label: 'Average engagement', value: analytics.avgRate === null ? 'Not enough data' : formatPct(analytics.avgRate) },
            { label: 'Best format', value: analytics.bestFormat ? analytics.bestFormat.key : 'Not enough data', hint: analytics.bestFormat ? formatPct(analytics.bestFormat.avgRate) : undefined },
          ]} />
          <Table aria-label="Sample posts">
            <THead><TR><TH>Post</TH><TH className="text-right">Views</TH><TH className="text-right">Engagement</TH></TR></THead>
            <TBody>
              {data.posts.map((p) => { const r = engagementRate(p); return (
                <TR key={p.id}><TD>{[p.platform, p.format].filter(Boolean).join(' · ')} <span className="text-muted-foreground">· {formatDate(p.published_at)}</span></TD><TD className="tabular text-right">{p.views === null ? 'Not logged' : formatNumber(p.views)}</TD><TD className="tabular text-right">{r === null ? 'Needs views' : formatPct(r)}</TD></TR>
              ); })}
            </TBody>
          </Table>
        </Section>

        <Section id="deals" title="Deals" description="Sample pipeline.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {DEAL_STAGES.map((stage) => (
              <div key={stage}>
                <h3 className="mb-2 text-xs font-medium capitalize text-muted-foreground">{stage}</h3>
                <ul className="space-y-2">
                  {data.deals.filter((d) => d.stage === stage).map((d) => (
                    <li key={d.id} className="rounded-md border border-border bg-card p-3 text-sm"><p className="font-medium">{d.brand}</p><p className="text-xs text-muted-foreground">{d.value === null ? 'No value entered' : formatMoney(Number(d.value))}</p></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">Weighted pipeline: <span className="tabular font-medium text-foreground">{formatMoney(pipeline.total)}</span>. {FORECAST_LABEL}</p>
        </Section>

        <Section id="revenue" title="Revenue" description="Sample invoices.">
          <StatStrip className="mb-6" stats={totals.flatMap((t) => [
            { label: `Collected (${t.currency})`, value: formatMoney(t.collected, t.currency) },
            { label: `Outstanding (${t.currency})`, value: formatMoney(t.outstanding, t.currency) },
            { label: `Overdue (${t.currency})`, value: formatMoney(t.overdue, t.currency) },
          ])} />
          <Table aria-label="Sample invoices">
            <THead><TR><TH>Brand</TH><TH className="text-right">Amount</TH><TH>Due</TH><TH>Status</TH></TR></THead>
            <TBody>
              {data.revenue.map((e) => { const s = effectiveStatus(e, now); return (
                <TR key={e.id}><TD>{dealName(e.deal_id)}</TD><TD className="tabular text-right">{formatMoney(Number(e.amount), e.currency)}</TD><TD>{formatDate(e.due_date)}</TD><TD><Badge variant={s === 'paid' ? 'success' : s === 'overdue' ? 'destructive' : 'secondary'}>{s === 'overdue' ? `Overdue ${daysOverdue(e, now)} days` : s}</Badge></TD></TR>
              ); })}
            </TBody>
          </Table>
        </Section>

        <Section id="locked" title="Not in the demo" description="These are in a real workspace and need your own accounts, so the demo leaves them off.">
          <ul className="grid gap-3 sm:grid-cols-2">
            {[
              ['Publish', 'Write once, approve each post yourself, then publish to YouTube and Instagram with a progress bar.'],
              ['Connections', 'Connect your YouTube channel and Instagram professional account with Google and Meta sign-in.'],
              ['Library and images', 'Upload media, or generate an image from a description. Generated images are always labelled as AI.'],
              ['Ads', 'Draft ad copy that fits Meta and YouTube limits. Drafts only: PBOS never spends your money.'],
              ['Agent', 'Tell it what you need. It makes drafts, ideas, images and ad copy from your own records, and asks before it changes anything that exists.'],
            ].map(([t, d]) => <li key={t} className="rounded-lg border border-dashed border-border p-4 text-sm"><p className="font-medium">{t}</p><p className="mt-1 text-muted-foreground">{d}</p></li>)}
          </ul>
          <Alert variant="info" title="Ready for your own data?" className="mt-6">Your workspace starts empty and fills only with what you enter or connect. <Link href="/signup" className="font-medium underline">Create it now</Link>.</Alert>
        </Section>
      </main>
    </div>
  );
}
