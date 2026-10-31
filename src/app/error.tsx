'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Last-resort boundary for public pages. The workspace has its own, friendlier boundary in (app)/error.tsx. */
export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-xl px-4 py-20">
      <h1 className="mb-4">Something went wrong</h1>
      <Alert variant="destructive" title="This page failed to load.">
        <p>It is usually temporary. Try again, or come back in a few minutes.</p>
        {error.digest ? <p className="mt-1 text-xs">Reference: {error.digest}</p> : null}
      </Alert>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">Go to the home page</Link>
        </Button>
      </div>
    </main>
  );
}
