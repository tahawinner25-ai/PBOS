'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/toast';

type RunResponse = {
  error?: string;
  status?: 'ok' | 'fallback' | 'clear' | 'no_data';
  message?: string | null;
  fallback?: { message: string } | null;
  flags?: unknown[];
  recommendations?: unknown[];
};

/** Calls /api/agent/daily for the signed-in creator, then re-renders the dashboard from the saved run. */
export function RunLoopButton({ creatorId, hasRun }: { creatorId: string; hasRun: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function run() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const res = await fetch('/api/agent/daily', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator_id: creatorId }),
      });
      let body: RunResponse = {};
      try {
        body = (await res.json()) as RunResponse;
      } catch {
        // Non-JSON error page: fall through to the generic message below.
      }
      if (!res.ok) {
        toast.push('error', body.error ?? 'The daily loop could not complete. Try again in a moment.');
        return;
      }
      if (body.status === 'fallback') {
        toast.push('info', `${body.fallback?.message ?? 'AI wording was unavailable.'} Showing rule-based results from your records.`);
      } else if (body.status === 'clear' || body.status === 'no_data') {
        toast.push('info', body.message ?? 'Nothing needs your attention right now.');
      } else {
        const n = body.recommendations?.length ?? 0;
        toast.push('success', n > 0 ? `Loop complete: ${n} ${n === 1 ? 'recommendation' : 'recommendations'} ready for your review.` : 'Loop complete.');
      }
      router.refresh();
    } catch {
      toast.push('error', 'Could not reach the server. Check your connection and try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <Button onClick={run} disabled={pending} aria-busy={pending}>
      <RefreshCw aria-hidden="true" className={pending ? 'animate-spin' : undefined} />
      {pending ? 'Scanning your records…' : hasRun ? 'Refresh the loop' : 'Run the daily loop'}
    </Button>
  );
}
