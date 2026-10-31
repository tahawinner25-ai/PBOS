import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { UserButton } from '@clerk/nextjs';
import { Brand } from '@/components/brand';
import { DisplaySettings } from '@/components/display-settings';
import { NavLinks } from '@/components/nav-links';

/** Sidebar on large screens, a scrolling tab bar under the header on small ones. */
export function AppShell({ name, niche, children }: { name: string | null; niche: string | null; children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden border-r border-border bg-card/40 lg:flex lg:flex-col" aria-label="Sidebar">
        <div className="sticky top-0 flex h-screen flex-col gap-6 p-5">
          <Brand href="/dashboard" />
          <nav aria-label="Main">
            <NavLinks orientation="vertical" />
          </nav>
          <div className="mt-auto space-y-3 text-sm">
            <Link href="/preview/media-kit" className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
              <ExternalLink aria-hidden="true" className="size-4" />
              Media kit preview
            </Link>
            <DisplaySettings />
            <div className="border-t border-border pt-3">
              <p className="truncate font-medium">{name ?? 'Your profile'}</p>
              {niche ? <p className="truncate text-xs text-muted-foreground">{niche}</p> : null}
              <div className="mt-3">
                <UserButton showName />
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <div className="border-b border-border bg-card/40 lg:hidden">
          <div className="flex items-center justify-between px-4 pt-3">
            <Brand href="/dashboard" />
            <div className="flex items-center gap-3">
              <DisplaySettings align="right" className="[&>div]:bottom-auto [&>div]:top-full [&>div]:mb-0 [&>div]:mt-2" />
              <UserButton />
            </div>
          </div>
          <nav aria-label="Main">
            <NavLinks orientation="horizontal" />
          </nav>
        </div>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
