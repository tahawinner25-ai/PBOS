'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';

/** Subscribe / Manage. Both only ask the server for a Stripe page address and go there; card details are never typed on PBOS. */
export function BillingActions({ mode, label, plan, confirmText, variant }: { mode: 'checkout' | 'portal' | 'upgrade'; label: string; plan?: 'pro' | 'max'; confirmText?: string; variant?: 'default' | 'outline' }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/billing/${mode === 'portal' ? 'portal' : mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) });
      const body = (await res.json().catch(() => ({}))) as { url?: string; message?: string };
      if (mode === 'upgrade' && res.ok) {
        window.location.assign('/billing?status=upgraded');
        return;
      }
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
      <Button onClick={go} disabled={busy} variant={variant}>{busy ? 'Opening…' : label}</Button>
      {error ? <Alert variant="destructive">{error}</Alert> : null}
    </div>
  );
}
