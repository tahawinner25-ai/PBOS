'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'pbos-consent';
export const OPEN_CONSENT_EVENT = 'pbos:open-consent';

type Choice = 'accepted' | 'declined';

function readChoice(): Choice | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'accepted' || v === 'declined' ? v : null;
  } catch {
    return null;
  }
}

function writeChoice(choice: Choice) {
  try {
    window.localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Storage can be blocked. The choice then lasts for this page view only.
  }
}

/** Signed-in workspace routes are never measured, even with consent. */
const PRIVATE_PREFIXES = ['/dashboard', '/ideas', '/analytics', '/deals', '/revenue', '/settings', '/onboarding', '/preview', '/login', '/signup'];

/**
 * Cookie consent banner and consent-gated analytics. PBOS itself sets only the cookies needed to keep
 * the creator signed in. The optional Plausible script loads only on public pages, only after the
 * visitor accepts, and only when NEXT_PUBLIC_PLAUSIBLE_DOMAIN is set.
 */
export function ConsentAndAnalytics({ plausibleDomain }: { plausibleDomain: string | null }) {
  const pathname = usePathname();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = readChoice();
    setChoice(stored);
    setOpen(stored === null);
    setReady(true);
    const reopen = () => setOpen(true);
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  const decide = useCallback((next: Choice) => {
    writeChoice(next);
    setChoice(next);
    setOpen(false);
  }, []);

  const isPrivate = PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const analyticsOn = ready && choice === 'accepted' && Boolean(plausibleDomain) && !isPrivate;

  return (
    <>
      {analyticsOn ? <Script defer data-domain={plausibleDomain ?? undefined} src="https://plausible.io/js/script.js" strategy="afterInteractive" /> : null}
      {ready && open ? (
        <section
          aria-label="Cookie consent"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl sm:inset-x-6"
        >
          <p className="text-sm leading-relaxed">
            PBOS uses only the cookies needed to keep you signed in.{' '}
            {plausibleDomain
              ? 'With your OK, public pages also load Plausible analytics to count visits.'
              : 'No analytics are loaded on this site.'}{' '}
            <Link href="/privacy" className="underline underline-offset-4">
              Privacy policy
            </Link>
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => decide('accepted')}>
              {plausibleDomain ? 'Accept analytics' : 'Got it'}
            </Button>
            {plausibleDomain ? (
              <Button size="sm" variant="outline" onClick={() => decide('declined')}>
                Decline
              </Button>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}

/** Footer link that reopens the banner so a visitor can change their choice. */
export function CookieSettingsButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
      Cookie settings
    </button>
  );
}
