'use client';

import { disconnectStripeAction, connectStripeAction, syncStripeAction } from '@/actions/stripe-revenue';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { ActionButton } from '@/components/action-button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';

export type StripeConn = { livemode: boolean; status: 'active' | 'invalid'; last_error: string | null; last_synced_at: string | null; charges_seen: number } | null;

/** Connect or manage the creator's own Stripe account. Read-only: PBOS can list charges and nothing else. */
export function StripeRevenuePanel({ connection }: { connection: StripeConn }) {
  if (connection) {
    return (
      <div className="surface space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">Stripe is connected</p>
          <Badge variant={connection.status === 'active' ? 'success' : 'destructive'}>{connection.status === 'active' ? 'Active' : 'Needs attention'}</Badge>
          <Badge variant="outline">{connection.livemode ? 'Live mode' : 'Test mode'}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {connection.last_synced_at ? `Last synced ${formatDate(connection.last_synced_at)}. ` : 'Not synced yet. '}
          Payments from the last 90 days appear below as Stripe payments, before Stripe’s fees, minus refunds. PBOS can only read your charges.
        </p>
        {connection.last_error ? <p className="text-sm text-destructive">{connection.last_error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <ActionButton action={syncStripeAction} pendingLabel="Syncing…" variant="outline">Sync now</ActionButton>
          <ActionButton action={disconnectStripeAction} pendingLabel="Disconnecting…" variant="ghost" confirm="Disconnect Stripe? The saved key is deleted and the payments imported from Stripe are removed from Revenue. Your manual invoices stay.">Disconnect</ActionButton>
        </div>
      </div>
    );
  }
  return (
    <div className="surface space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        Show the payments you receive on Stripe next to your invoices. Create a <strong className="font-medium text-foreground">restricted key</strong> in Stripe with <strong className="font-medium text-foreground">Read</strong> access to <strong className="font-medium text-foreground">Charges</strong> only, and paste it here. Never paste your full secret key. The key is encrypted, never shown again, and you can disconnect any time.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Stripe dashboard → Developers → API keys → Create restricted key.</li>
        <li>Under Charges choose Read, leave everything else as None, and create it.</li>
        <li>Copy the key (it starts with rk_) and paste it below.</li>
      </ol>
      <ActionForm action={connectStripeAction} className="max-w-xl space-y-3" resetOnSuccess>
        <Field label="Restricted key" name="restricted_key" required>
          <Input type="password" autoComplete="off" spellCheck={false} placeholder="rk_test_… or rk_live_…" />
        </Field>
        <SubmitButton pendingLabel="Checking with Stripe…">Connect Stripe</SubmitButton>
      </ActionForm>
    </div>
  );
}
