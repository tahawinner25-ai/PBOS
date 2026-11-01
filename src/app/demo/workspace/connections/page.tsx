import type { Metadata } from 'next';
import { DemoLocked, DemoShell } from '@/components/demo-shell';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'YouTube & Instagram · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoConnectionsPage() {
  const { remainingMs } = await loadDemoPage('/demo/workspace/connections');
  return (
    <DemoShell remainingMs={remainingMs}>
      <DemoLocked
        title="YouTube & Instagram"
        lead="Connect your channel and your Instagram professional account to publish from PBOS and pull in real analytics. Anything PBOS cannot read stays empty instead of being invented."
        points={[
          ['YouTube', 'Sign in with Google and allow upload and analytics access. You can disconnect at any time.'],
          ['Instagram', 'Sign in with Meta. Publishing needs an Instagram professional (Business or Creator) account.'],
          ['Tokens stay encrypted', 'Access tokens are encrypted before they are stored and are never shown to the AI.'],
          ['You approve every post', 'Connecting an account does not let PBOS post on its own.'],
        ]}
        cta="Create your workspace to connect"
      />
    </DemoShell>
  );
}
