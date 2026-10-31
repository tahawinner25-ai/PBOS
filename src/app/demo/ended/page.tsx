import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Your demo has ended', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function DemoEndedPage() {
  return (
    <PublicShell>
      <main id="main" className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <h1>Your 10 minutes are up</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          The demo is locked. Nothing you did in it was saved, because it only ever held sample data. To use PBOS on your own ideas, deals and invoices, create a workspace. It is free to start, and there is no time limit.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link href="/signup">Create your workspace</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="/login">Sign in</Link></Button>
        </div>
        <p className="mt-6 text-sm text-muted-foreground"><Link href="/" className="underline">Back to the home page</Link></p>
      </main>
    </PublicShell>
  );
}
