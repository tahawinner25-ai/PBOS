import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { setupStatus } from '@/lib/env';
import { cn } from '@/lib/utils';

/** Log the missing names once per server instance, not on every request. */
let loggedMissing = false;

/**
 * Shown instead of a crash when the sign-in or database settings are missing.
 *
 * Visitors to a deployed site never see configuration details: setup steps and variable
 * names are for whoever runs the deployment, not for a creator trying to sign in. So:
 *  - production: a short neutral message; the missing NAMES (never values) go to the
 *    server log once, where the operator will look.
 *  - development: the technical checklist, so a fresh clone tells you what to add.
 */
export function SetupNeeded() {
  const status = setupStatus();

  if (process.env.NODE_ENV !== 'production') {
    return (
      <div className="mx-auto max-w-xl px-4 py-16">
        <h1 className="mb-4">Finish setting up PBOS</h1>
        <Alert variant="warning" title="Local setup is incomplete.">
          <p>
            PBOS signs you in with Clerk and stores records in Supabase. Add these variables to <code>.env.local</code> and restart. The README walks through each
            step.
          </p>
          {status.missing.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {status.missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </Alert>
      </div>
    );
  }

  if (!loggedMissing) {
    loggedMissing = true;
    // Names only, never values. Operators find this in the deployment logs.
    console.error(`[pbos] sign-in is unavailable: missing settings → ${status.missing.join(', ') || '(none reported)'}`);
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="mb-3">Sign-in isn’t open just yet</h1>
      <p className="mx-auto mb-6 max-w-prose text-muted-foreground">
        We’re finishing the last checks on PBOS. Please come back shortly.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/demo" className={cn(buttonVariants())}>
          Try the 10-minute demo
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          Back to the home page
        </Link>
      </div>
    </div>
  );
}
