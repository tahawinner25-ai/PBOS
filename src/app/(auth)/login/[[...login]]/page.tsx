import type { Metadata } from 'next';
import Link from 'next/link';
import { SignIn } from '@clerk/nextjs';
import { SetupNeeded } from '@/components/setup-needed';
import { clerkConfigured } from '@/lib/env';

export const metadata: Metadata = { title: 'Sign in', alternates: { canonical: '/login' } };

export default function LoginPage() {
  if (!clerkConfigured()) return <SetupNeeded />;
  return (
    <>
      <h1 className="mb-1">Sign in</h1>
      <p className="mb-6 text-sm text-muted-foreground">Open your daily operator view.</p>

      <SignIn routing="path" path="/login" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />

      <p className="mt-6 text-sm text-muted-foreground">
        First time here?{' '}
        <Link href="/signup" className="text-foreground underline underline-offset-4">
          Create the creator account
        </Link>
      </p>
    </>
  );
}
