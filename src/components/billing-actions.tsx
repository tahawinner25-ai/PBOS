'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

/** Subscribe / Manage. Both only ask the server for a Stripe page address and go there; card details are never typed on PBOS. */
export function BillingActions({ mode, label }: { mode: 'checkout' | 'portal'; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(mode === 'checkout' ? '/api/billing/checkout' : '/api/billing/portal', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (res.ok && body.url && body.url.startsWith('https://')) {
        window.location.assign(body.url);
        return;
      }
      setError(body.message ?? 'That did not work. Nothing was charged. Try again in a moment.');
    } catch {
      setError('The request could not be sent. Check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <Button onClick={go} disabled={busy}>{busy ? 'Opening…' : label}</Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
