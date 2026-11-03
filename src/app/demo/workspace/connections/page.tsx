import type { Metadata } from 'next';
import { DemoLocked, DemoShell } from '@/components/demo-shell';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Connections · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoConnectionsPage() {
  const { remainingMs } = await loadDemoPage('/demo/workspace/connections');
  return (
    <DemoShell remainingMs={remainingMs}>
      <DemoLocked
        title="Connections"
        lead="Connect your channel, your Instagram professional account and your Gmail to publish, pull in real analytics and send the emails you approve. Anything PBOS cannot read stays empty instead of being invented."
        points={[
          ['YouTube', 'Sign in with Google and allow upload and analytics access. You can disconnect at any time.'],
          ['Instagram', 'Sign in with Meta. Publishing needs an Instagram professional (Business or Creator) account.'],
          ['Gmail', 'Send-only permission. PBOS cannot read your inbox, and every email waits for your Approve on the exact text.'],
          ['Tokens stay encrypted', 'Access tokens are encrypted before they are stored and are never shown to the AI.'],
          ['You approve every post and email', 'Connecting an account does not let PBOS post or send on its own.'],
        ]}
        cta="Create your workspace to connect"
      />
    </DemoShell>
  );
}
