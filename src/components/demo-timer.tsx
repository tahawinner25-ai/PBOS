'use client';

import { useEffect, useRef, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Countdown. The server sends how many milliseconds are left at render time; the browser counts down from there
 * with its own monotonic clock, so a wrong device clock cannot change it. This is only a display: when it
 * reaches zero it navigates to the ended page, and the server refuses the workspace after the signed expiry
 * whether or not this script ran.
 */
export function DemoTimer({ remainingMs }: { remainingMs: number }) {
  const startedAt = useRef<number>(0);
  const [left, setLeft] = useState(remainingMs);

  useEffect(() => {
    startedAt.current = performance.now();
    const tick = () => {
      const next = Math.max(0, remainingMs - (performance.now() - startedAt.current));
      setLeft(next);
      if (next <= 0) window.location.replace('/demo/ended');
    };
    const id = window.setInterval(tick, 250);
    // Coming back to a sleeping tab: recompute straight away instead of waiting for the next tick.
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => { window.clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [remainingMs]);

  const secs = Math.ceil(left / 1000);
  const label = `${pad(Math.floor(secs / 60))}:${pad(secs % 60)}`;
  const urgent = secs <= 60;
  // Announce only at the thresholds, not every second.
  const spoken = secs <= 0 ? 'The demo has ended.' : secs <= 60 ? 'One minute left.' : secs <= 120 ? 'Two minutes left.' : '';
  return (
    <div className="flex items-center gap-2" role="timer" aria-label={`Time left in the demo: ${label}`}>
      <span className="text-xs text-muted-foreground">Demo time left</span>
      <span className={`tabular rounded-md border px-2 py-1 font-mono text-sm ${urgent ? 'border-destructive text-destructive' : 'border-border'}`}>{label}</span>
      <span className="sr-only" aria-live="polite">{spoken}</span>
    </div>
  );
}
