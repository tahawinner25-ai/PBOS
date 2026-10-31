import type { Metadata } from 'next';
import Link from 'next/link';
import { AgentWorkspace } from '@/components/agent-workspace';
import { PageHeader, Section } from '@/components/page-header';
import { RunLoopButton } from '@/components/run-loop-button';
import { Badge } from '@/components/ui/badge';
import { toFeedItem } from '@/lib/agent/activity';
import { buildDailyPlan } from '@/lib/agent/daily';
import { requireCreator } from '@/lib/auth';
import { loadActions } from '@/lib/server/agent-log';
import { loadAgentData } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Agent' };
export const dynamic = 'force-dynamic';
// The agent runs from /api/agent/run; this page only reads.
export const maxDuration = 60;

const WATCHES: Array<[string, string]> = [
  ['Ideation', 'Ideas that have sat unscripted for more than 7 days; your best format with no follow-up idea.'],
  ['Posting', 'Posts whose result is unclear, failed posts, drafts waiting for approval, approved Instagram posts that are late, sign-ins that need reconnecting or are about to expire.'],
  ['Analytics', 'Posts with no numbers, accounts whose numbers have not synced in 3 days, hand-tracked posts with no account connected.'],
  ['Deals', 'Deals that have not moved stage in more than 7 days; missing profile details that block outreach.'],
  ['Revenue', 'Overdue invoices, with the follow-up escalating from reminder to final notice.'],
];

const RULES: Array<[string, string]> = [
  ['Reads', 'Your ideas, posts, deals, invoices, publish drafts, library, ad drafts and inbound inquiries. It never sees tokens, contact emails or file paths.'],
  ['Makes on its own', 'New ideas, scripts for ideas that have none, hook variants, publish drafts (never approved or scheduled), AI images, ad copy drafts, written drafts such as emails and captions, and a record of a post you say you published. Each can be undone with one click.'],
  ['Asks first', 'Moving a deal, changing an invoice or idea status, scheduling an idea, saving metrics. It queues a request and nothing changes until you press Approve.'],
  ['Cannot do', 'Publish, approve a post, send email, issue or collect an invoice, submit or pay for ads, or delete anything. Those stay your own clicks on their own pages.'],
  ['Numbers', 'It saves a metric only if you typed that number in this conversation. It never estimates views, followers or revenue.'],
  ['Limits', 'A few steps and a handful of new items per request, and a daily cap on requests. If it stops at a limit it says so.'],
];

export default async function AgentPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { profile, supabase } = ctx;
  const [data, actions] = await Promise.all([loadAgentData(supabase, profile), loadActions(supabase, profile.id, 40)]);
  const plan = buildDailyPlan(data, new Date());

  return (
    <>
      <PageHeader
        title="Agent"
        description="Your operator inside PBOS. Tell it what you need and it reads your workspace, makes the drafts, ideas, images and ad copy, and asks before changing anything that exists. You approve everything that goes out."
        actions={<RunLoopButton creatorId={profile.id} hasRun={false} />}
      />

      <Section title="Right now" description="Computed from your records each time you open this page.">
        {plan.flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{plan.hasRecords ? 'All checks pass. Nothing needs your attention.' : 'No records yet, so there is nothing to scan.'}</p>
        ) : (
          <ul className="ledger" aria-label="Current findings">
            {plan.flags.map((f) => (
              <li key={f.key} className="flex flex-wrap items-start gap-3 py-3 text-sm">
                <Badge variant="outline" className="shrink-0">{f.pillar}</Badge>
                <span className="min-w-0 flex-1 leading-relaxed">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-muted-foreground">Recommendations, drafts and your Accept or Ignore choices are on the <Link href="/dashboard" className="underline">dashboard</Link>.</p>
      </Section>

      <Section title="Work with the agent">
        <div className="rounded-lg border border-border bg-card p-5"><AgentWorkspace aiReady={Boolean(process.env.ANTHROPIC_API_KEY)} initialFeed={actions.map(toFeedItem)} /></div>
      </Section>

      <Section title="What it can and cannot do" description="These limits are enforced by the server, not just stated to the AI.">
        <dl className="ledger text-sm">
          {RULES.map(([title, text]) => (
            <div key={title} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr]"><dt className="font-medium">{title}</dt><dd className="text-muted-foreground">{text}</dd></div>
          ))}
        </dl>
      </Section>

      <Section title="What it watches" description="Every finding comes from a rule that reads your records. The AI words findings and drafts; it cannot add a finding of its own.">
        <dl className="ledger text-sm">
          {WATCHES.map(([pillar, text]) => (
            <div key={pillar} className="grid gap-1 py-3 sm:grid-cols-[8rem_1fr]"><dt className="font-medium">{pillar}</dt><dd className="text-muted-foreground">{text}</dd></div>
          ))}
        </dl>
      </Section>

      {plan.feedback.notes.length > 0 ? (
        <Section title="What it learned from your choices">
          <ul className="space-y-1.5 text-sm text-muted-foreground">{plan.feedback.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Section>
      ) : null}
    </>
  );
}
