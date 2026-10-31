import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/components/auth-forms';
import { SetupNeeded } from '@/components/setup-needed';
import { Alert } from '@/components/ui/alert';
import { getSessionContext } from '@/lib/auth';
import { signupGate } from '@/lib/server/signup-guard';

export const metadata: Metadata = { title: 'Set up your profile', alternates: { canonical: '/onboarding' } };

export default async function OnboardingPage() {
  const ctx = await getSessionContext();
  if (!ctx.configured) return <SetupNeeded />;
  if (!ctx.user) redirect('/login');
  if (ctx.profile) redirect('/dashboard');

  const gate = await signupGate();
  if (!gate.open) {
    return (
      <>
        <h1 className="mb-4">This workspace already has a creator</h1>
        <Alert variant="warning" title="Profile setup is closed.">
          {gate.reason}
        </Alert>
        <p className="mt-4 text-sm text-muted-foreground">
          <Link href="/" className="text-foreground underline underline-offset-4">
            Back to the home page
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="mb-1">Tell PBOS who you are</h1>
      <p className="mb-6 text-sm leading-relaxed text-muted-foreground">
        Every recommendation PBOS makes points back to your profile, your records or a goal you state here. Only your name is required. You can fill in the rest
        later, and PBOS will ask for one missing detail at a time.
      </p>

      <OnboardingForm />
    </>
  );
}
