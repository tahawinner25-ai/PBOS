import type { Metadata } from 'next';
import Link from 'next/link';
import { SignUp } from '@clerk/nextjs';
import { SetupNeeded } from '@/components/setup-needed';
import { Alert } from '@/components/ui/alert';
import { clerkConfigured } from '@/lib/env';
import { signupGate } from '@/lib/server/signup-guard';

export const metadata: Metadata = { title: 'Create account', alternates: { canonical: '/signup' } };

export default async function SignupPage() {
  if (!clerkConfigured()) return <SetupNeeded />;
  const gate = await signupGate();

  return (
    <>
      <h1 className="mb-1">Create your account</h1>
      <p className="mb-6 text-sm text-muted-foreground">Your workspace is private to you: other creators can never see your ideas, deals, numbers or connected accounts. Sign up with Google or email.</p>

      {gate.open ? (
        <SignUp routing="path" path="/signup" signInUrl="/login" fallbackRedirectUrl="/onboarding" />
      ) : (
        <Alert variant="warning" title="Sign-up is closed.">
          {gate.reason}
        </Alert>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        By creating an account you agree to the{' '}
        <Link href="/terms" className="underline underline-offset-4">
          terms
        </Link>{' '}
        and the{' '}
        <Link href="/privacy" className="underline underline-offset-4">
          privacy policy
        </Link>
        .
      </p>
      <p className="mt-4 text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </>
  );
}
