import { ClerkProvider } from '@clerk/nextjs';
import { clerkAppearance } from '@/lib/clerk-appearance';
import { clerkConfigured } from '@/lib/env';

/**
 * Clerk's provider for the private part of the site (sign-in, sign-up, onboarding and the workspace).
 * It is mounted on those route groups only, so the public pages stay static and never load Clerk.
 * Without Clerk keys it renders nothing extra: ClerkProvider throws on a missing key, and the pages
 * inside show a setup notice instead.
 */
export function ClerkShell({ children }: { children: React.ReactNode }) {
  if (!clerkConfigured()) return <>{children}</>;
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      signInUrl="/login"
      signUpUrl="/signup"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
      afterSignOutUrl="/"
    >
      {children}
    </ClerkProvider>
  );
}
