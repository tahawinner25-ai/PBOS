import type { Metadata } from 'next';
import { DemoShell } from '@/components/demo-shell';
import { PageHeader, Section } from '@/components/page-header';
import { StatStrip } from '@/components/stat-strip';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate, formatNumber } from '@/lib/format';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Ideation · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoIdeasPage() {
  const { remainingMs, view } = await loadDemoPage('/demo/workspace/ideas');
  const { ideas } = view.data;
  const count = (s: string) => ideas.filter((i) => i.status === s).length;
  return (
    <DemoShell remainingMs={remainingMs}>
      <PageHeader
        title="Ideation"
        description="Your idea bank. In a real workspace you add ideas, get hook variants and scripts from the assistant, schedule them, and adapt one idea across platforms."
        actions={<Button disabled aria-describedby="demo-note">Add an idea</Button>}
      />
      <p id="demo-note" className="-mt-4 mb-6 text-xs text-muted-foreground">Adding and editing is switched off in the sample workspace.</p>
      <StatStrip className="mb-8" stats={[
        { label: 'Ideas', value: formatNumber(ideas.length) },
        { label: 'Scripted', value: formatNumber(count('scripted')) },
        { label: 'Scheduled', value: formatNumber(count('scheduled')) },
        { label: 'Posted or measured', value: formatNumber(count('posted') + count('measured')) },
      ]} />
      <Section title="Idea bank" description="Sample ideas for an invented creator.">
        <ul className="ledger" aria-label="Ideas">
          {ideas.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3 text-sm">
              <span className="min-w-0 flex-1 font-medium">{i.hook}</span>
              <span className="text-muted-foreground">{[i.platform, i.format].filter(Boolean).join(' · ')}</span>
              <Badge variant="secondary">{i.status}</Badge>
              {i.scheduled_for ? <span className="text-xs text-muted-foreground">Scheduled {formatDate(i.scheduled_for)}</span> : null}
            </li>
          ))}
        </ul>
      </Section>
    </DemoShell>
  );
}
