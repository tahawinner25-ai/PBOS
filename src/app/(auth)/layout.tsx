import type { Metadata } from 'next';
import { Brand } from '@/components/brand';
import { ClerkShell } from '@/components/clerk-shell';

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkShell>
      <div className="flex min-h-screen flex-col items-center px-4 py-10 sm:py-16">
        <Brand />
        <main id="main" tabIndex={-1} className="mt-10 w-full max-w-md">
          {children}
        </main>
      </div>
    </ClerkShell>
  );
}
