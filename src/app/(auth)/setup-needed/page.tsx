import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { clerkDomainOf } from '@/lib/auth-errors';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'One more setup step', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Shown to a signed-in person when Supabase refuses the Clerk sign-in token. It happens once, on a new deployment, until the
 * owner links Clerk and Supabase. Names the exact steps; shows only the Clerk domain, which is public.
 */
export default function SetupNeededPage() {
  const domain = clerkDomainOf(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  return (
    <>
      <h1 className="mb-2">You are signed in. One setup step is left.</h1>
      <Alert variant="warning" title="The database does not trust this sign-in yet.">
        <p>Your account works. Supabase just has not been told to accept Clerk sign-ins, so PBOS cannot read your profile. Nothing was lost.</p>
      </Alert>
      <ol className="mt-6 list-decimal space-y-3 pl-5 text-sm leading-relaxed">
        <li>
          In Clerk, open <strong>Integrations → Supabase</strong> and press <strong>Activate</strong>. This adds the <code>role</code> claim Supabase needs.
        </li>
        <li>
          In Supabase, open <strong>Authentication → Sign In / Providers → Third-Party Auth</strong>, add <strong>Clerk</strong>
          {domain ? (
            <>
              {' '}
              and enter the domain <code className="break-all">{domain}</code>
            </>
          ) : (
            <> and enter your Clerk domain</>
          )}
          .
        </li>
        <li>Reload this site. No redeploy is needed.</li>
      </ol>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/dashboard" className={cn(buttonVariants())}>
          I have done it, try again
        </Link>
        <Link href="/" className={cn(buttonVariants({ variant: 'outline' }))}>
          Back to the home page
        </Link>
      </div>
    </>
  );
}
