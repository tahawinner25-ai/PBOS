'use client';

import { useEffect } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Catches failed database reads on any workspace page and offers a retry instead of a blank screen. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="max-w-xl">
      <h1 className="mb-4">This page could not load</h1>
      <Alert variant="destructive" title="Your data is safe. The page failed to read it.">
        <p>This is usually a short database or network problem. Nothing you entered was changed.</p>
        {error.digest ? <p className="mt-1 text-xs">Reference: {error.digest}</p> : null}
      </Alert>
      <Button className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
