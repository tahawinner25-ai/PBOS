import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Agent · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const RULES: Array<[string, string]> = [
  ['Reads', 'Your ideas, posts, deals, invoices, publish drafts, library, ad drafts and inquiries. Never tokens, contact emails or file paths.'],
  ['Makes on its own', 'New ideas, scripts, hook variants, publish drafts (never approved), AI images, ad copy and written drafts. Each can be undone with one click.'],
  ['Asks first', 'Moving a deal, changing an invoice or idea status, scheduling an idea, saving metrics. Nothing changes until you press Approve.'],
  ['Cannot do', 'Publish, approve a post, send email, collect payment, spend on ads, or delete anything.'],
];

export default async function DemoAgentPage() {
  const { remainingMs, view } = await loadDemoPage('/demo/workspace/agent');
  const { plan } = view;
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader title="Agent" description="Your operator inside PBOS. In a real workspace you tell it what you need and it reads your records, makes the drafts, and asks before changing anything that exists." />

      <Section title="Ask the agent" description="The AI is switched off in the demo, so this box is not active.">
        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <label htmlFor="agent-input" className="text-sm font-medium">What should the agent do?</label>
          <Textarea id="agent-input" rows={3} disabled placeholder="For example: draft a follow-up for the invoice that is past due." />
          <Button disabled>Send to the agent</Button>
        </div>
      </Section>

      <Section title="What it would work on first" description="These come from the same rules a real workspace uses, applied to the sample records.">
        <ul className="ledger" aria-label="Findings">
          {plan.flags.map((f) => (
            <li key={f.key} className="flex flex-wrap items-start gap-3 py-3 text-sm">
              <Badge variant="outline" className="shrink-0">{f.pillar}</Badge>
              <span className="min-w-0 flex-1 leading-relaxed">{f.message}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="What it can and cannot do" description="In a real workspace these limits are enforced by the server, not just stated to the AI.">
        <dl className="ledger text-sm">
          {RULES.map(([t, d]) => <div key={t} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr]"><dt className="font-medium">{t}</dt><dd className="text-muted-foreground">{d}</dd></div>)}
        </dl>
      </Section>

      <Alert variant="info" title="Want it working on your own records?"><Link href="/signup" className="font-medium underline">Create your workspace</Link> and the agent reads only what you enter or connect.</Alert>
    </DemoShell>
  );
}
