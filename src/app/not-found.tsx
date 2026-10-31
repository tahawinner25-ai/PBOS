import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Page not found', robots: { index: false, follow: false } };

export default function NotFound() {
  return (
    <PublicShell>
      <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-20">
        <h1 className="mb-3">Page not found</h1>
        <p className="mb-6 text-muted-foreground">The page you asked for does not exist, or it has not been published. Check the address, or go back to somewhere that does.</p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Open your dashboard</Link>
          </Button>
        </div>
      </main>
    </PublicShell>
  );
}
