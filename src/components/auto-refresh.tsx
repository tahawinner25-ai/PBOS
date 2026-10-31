'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetches the page's server data every few seconds while something is in flight (an upload being processed, a post being published). */
export function AutoRefresh({ active, everyMs = 5000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, everyMs);
    return () => window.clearInterval(id);
  }, [active, everyMs, router]);
  return null;
}
