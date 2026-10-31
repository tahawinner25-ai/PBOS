import Link from 'next/link';
import { Brand } from '@/components/brand';
import { CookieSettingsButton } from '@/components/consent-analytics';
import { DisplaySettings } from '@/components/display-settings';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FOOTER_LINKS = [
  { href: '/blog', label: 'Blog' },
  { href: '/privacy', label: 'Privacy policy' },
  { href: '/terms', label: 'Terms' },
  { href: '/cookies', label: 'Cookies' },
  { href: '/security', label: 'Security' },
  { href: '/data-deletion', label: 'Data deletion' },
  { href: '/accessibility', label: 'Accessibility' },
] as const;

/** Shared frame for public pages. `paper` is the light reading theme; `desk` is the product's dark theme. */
export function PublicShell({ theme = 'paper', children }: { theme?: 'paper' | 'desk'; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-h-screen flex-col bg-background text-foreground', theme === 'paper' && 'theme-paper')}>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <Brand />
          <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-3">
            <Link href="/#how-it-works" className="hidden rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground sm:inline">
              How it works
            </Link>
            <Link href="/#faq" className="hidden rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground sm:inline">
              FAQ
            </Link>
            <Link href="/blog" className="hidden rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground sm:inline">
              Blog
            </Link>
            <Link href="/demo" className="rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground">
              Try the demo
            </Link>
            <Link href="/work-with-me" className="rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground">
              Work with me
            </Link>
            <Button asChild size="sm" variant={theme === 'paper' ? 'outline' : 'secondary'}>
              <Link href="/login">Sign in</Link>
            </Button>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <p>PBOS, the Personal Brand Operating System.</p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {FOOTER_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-foreground">
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton className="hover:text-foreground" />
            </li>
            <li>
              <DisplaySettings align="right" />
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
