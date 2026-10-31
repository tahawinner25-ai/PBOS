import type { Metadata } from 'next';
import { AppShell } from '@/components/app-shell';
import { ClerkShell } from '@/components/clerk-shell';
import { SetupNeeded } from '@/components/setup-needed';
import { requireCreator } from '@/lib/auth';

// The workspace is private: keep it out of search results and never cache it.
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCreator();
  if (!ctx) {
    return (
      <main id="main" tabIndex={-1}>
        <SetupNeeded />
      </main>
    );
  }
  return (
    <ClerkShell>
      <AppShell name={ctx.profile.name} niche={ctx.profile.niche}>
        {children}
      </AppShell>
    </ClerkShell>
  );
}
