import type { Metadata } from 'next';
import { DemoLocked, DemoShell } from '@/components/demo-shell';
import { loadDemoPage } from '@/lib/server/demo-page';

export const metadata: Metadata = { title: 'AI images · PBOS demo', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function DemoImagesPage() {
  const { remainingMs } = await loadDemoPage('/demo/workspace/images');
  return (
    <DemoShell remainingMs={remainingMs}>
      <DemoLocked
        title="AI images and library"
        lead="Create an image from a description, or upload your own, then attach it to a post. Your media is private to you."
        points={[
          ['Describe it, get an image', 'Write what you want and pick a shape for the platform you are posting to.'],
          ['Always labelled', 'AI-generated images are marked as AI-generated everywhere in PBOS.'],
          ['A daily allowance', 'Image generation has a daily limit so a mistake cannot run up a bill.'],
          ['Your library', 'Uploads and generated images live in one private library, ready to attach to a post.'],
        ]}
      />
    </DemoShell>
  );
}
