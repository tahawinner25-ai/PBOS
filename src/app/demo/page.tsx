import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/public-shell';
import { Turnstile } from '@/components/turnstile';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { demoSecretOk, DEMO_MS } from '@/lib/demo-session';
import { currentDemo, demoUsed } from '@/lib/server/demo';
import { turnstileConfig } from '@/lib/server/turnstile';

export const metadata: Metadata = {
  title: 'Try PBOS for 10 minutes',
  description: 'Open a sample workspace for ten minutes, no sign-up. See the daily loop find problems in sample ideas, deals and invoices. It locks when the time is up.',
  alternates: { canonical: '/demo' },
};
export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  unavailable: 'The demo is not available on this deployment right now.',
  busy: 'Several demos were started from your network recently. Try again in an hour, or sign up to use PBOS without a time limit.',
  captcha: 'We could not confirm you are a person. Please try again.',
};

export default async function DemoPage({ searchParams }: { searchParams: { e?: string } }) {
  const demo = await currentDemo();
  const used = demoUsed();
  const error = searchParams.e ? MESSAGES[searchParams.e] : null;
  const configured = demoSecretOk(process.env.DEMO_SESSION_SECRET) && turnstileConfig(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, process.env.TURNSTILE_SECRET_KEY) !== 'misconfigured';
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  return (
    <PublicShell>
      <main id="main" className="mx-auto max-w-2xl px-4 py-14 sm:px-6">
        <p className="text-sm text-muted-foreground">No sign-up. No card.</p>
        <h1 className="mt-2">Try PBOS for {DEMO_MS / 60_000} minutes</h1>
        <p className="mt-4 leading-relaxed text-muted-foreground">
          You get a sample workspace: invented ideas, posts, brand deals and invoices. The same checks that run in a real workspace scan them, flag what needs attention, suggest what to do first with the
          reasons, and draft one email. When the ten minutes are up the demo locks, and the server enforces that, not just the timer on screen.
        </p>
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li>Everything is sample data and nothing you do is saved.</li>
          <li>Publishing, your own accounts, images and ads are part of the real product, so they are switched off here. The demo never connects to or posts anywhere.</li>
          <li>One demo per browser each day.</li>
        </ul>

        {error ? <Alert variant="destructive" title={error} className="mt-8" /> : null}

        <div className="mt-8">
          {demo.state === 'valid' ? (
            <Button asChild size="lg"><Link href="/demo/workspace">Continue your demo</Link></Button>
          ) : demo.state === 'expired' || used ? (
            <div className="space-y-4">
              <Alert variant="info" title="Your demo for today has ended">The time limit is per browser per day. Sign up to keep going with your own data, no time limit.</Alert>
              <Button asChild size="lg"><Link href="/signup">Create your workspace</Link></Button>
            </div>
          ) : !configured ? (
            <Alert variant="info" title="The demo is not switched on here">The site owner has not set DEMO_SESSION_SECRET yet.</Alert>
          ) : (
            <form method="post" action="/api/demo/start" className="space-y-4">
              {siteKey ? <Turnstile siteKey={siteKey} /> : null}
              <Button type="submit" size="lg">Start the {DEMO_MS / 60_000}-minute demo</Button>
              <p className="text-xs text-muted-foreground">Starting the demo sets two cookies that only hold the demo’s clock. See the <Link href="/privacy" className="underline">privacy policy</Link>.</p>
            </form>
          )}
        </div>
      </main>
    </PublicShell>
  );
}
