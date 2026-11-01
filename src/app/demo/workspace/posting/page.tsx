import type { Metadata } from 'next';
import Link from 'next/link';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Posting · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STEPS: Array<[string, string]> = [
  ['1. Write once', 'Choose YouTube or Instagram, add the media, title and caption. The assistant can draft the caption.'],
  ['2. You approve', 'Nothing goes out until you press Approve on that post. PBOS never publishes on its own.'],
  ['3. It posts, and says what happened', 'You see progress while it uploads. If a result is unclear, PBOS stops and asks you instead of posting twice.'],
];

export default async function DemoPostingPage() {
  const { remainingMs, view } = await loadDemoPage('/demo/workspace/posting');
  const { ideas, posts } = view.data;
  const queued = ideas.filter((i) => i.status === 'scheduled' || i.status === 'scripted');
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader
        title="Posting"
        description="Publish to YouTube and Instagram from one place. In the sample workspace you can look at the flow; publishing itself needs your own connected accounts."
        actions={<Button disabled aria-describedby="demo-note">New post</Button>}
      />
      <p id="demo-note" className="-mt-4 mb-6 text-xs text-muted-foreground">Publishing is switched off in the demo. It never connects to or posts anywhere.</p>

      <Section title="How a post goes out">
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map(([t, d]) => <li key={t} className="rounded-lg border border-border bg-card p-4 text-sm"><p className="font-medium">{t}</p><p className="mt-1 text-muted-foreground">{d}</p></li>)}
        </ol>
      </Section>

      <Section title="Coming up" description="Sample ideas that are scripted or scheduled.">
        {queued.length === 0 ? <p className="text-sm text-muted-foreground">Nothing is queued.</p> : (
          <ul className="ledger" aria-label="Queue">
            {queued.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
                <span className="min-w-0 flex-1 font-medium">{i.hook}</span>
                <span className="text-muted-foreground">{[i.platform, i.format].filter(Boolean).join(' · ')}</span>
                <Badge variant="secondary">{i.status === 'scheduled' ? 'Scheduled' : 'Script ready'}</Badge>
                {i.scheduled_for ? <span className="text-xs text-muted-foreground">{formatDate(i.scheduled_for)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Already posted" description="Sample posts being tracked.">
        <Table aria-label="Sample posts">
          <THead><TR><TH>Post</TH><TH>Date</TH><TH>Numbers</TH></TR></THead>
          <TBody>
            {posts.map((p) => (
              <TR key={p.id}><TD>{[p.platform, p.format].filter(Boolean).join(' · ')}</TD><TD>{formatDate(p.published_at)}</TD><TD>{p.views === null ? 'Not logged' : 'Logged'}</TD></TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Alert variant="info" title="Ready to post for real?">
        Connect your accounts on the <Link href="/demo/workspace/connections" className="underline">YouTube &amp; Instagram</Link> page, or <Link href="/signup" className="font-medium underline">create your workspace</Link>.
      </Alert>
    </DemoShell>
  );
}
