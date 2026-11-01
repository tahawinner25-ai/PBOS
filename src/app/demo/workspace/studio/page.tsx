import type { Metadata } from 'next';
import { DemoLocked, DemoShell } from '@/components/demo-shell';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'Studio · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoStudioPage() {
  const { remainingMs } = await loadDemoPage('/demo/workspace/studio');
  return (
    <DemoShell remainingMs={remainingMs}>
      <DemoLocked
        title="Studio"
        lead="Cut, join and caption short videos in your browser. Your footage stays on your device while you edit. Only a finished video you choose to save is uploaded."
        points={[
          ['Trim and join', 'Cut clips on a timeline and put them in the order you want.'],
          ['Captions', 'Add on-screen text and caption lines you write yourself.'],
          ['Export', 'Render a finished video in your browser, then save it to your library.'],
          ['Private by default', 'Raw footage is not uploaded. Nothing is posted until you approve it on the Posting page.'],
        ]}
      />
    </DemoShell>
  );
}
