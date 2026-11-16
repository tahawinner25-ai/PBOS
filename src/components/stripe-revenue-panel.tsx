'use client';

import { disconnectStripeAction, connectStripeAction, setupStripeWebhookAction, syncStripeAction } from '@/actions/stripe-revenue';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { ActionButton } from '@/components/action-button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';

export type StripeConn = { livemode: boolean; status: 'active' | 'invalid'; last_error: string | null; last_synced_at: string | null; charges_seen: number; webhook_id: string | null; webhook_last_event_at: string | null } | null;

/** Connect or manage the creator's own Stripe account. Read access shows your payments; optional write access lets the agent issue invoices you approve, and lets Stripe tell PBOS when they are paid. */
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
          Payments from the last 90 days appear below as Stripe payments, before Stripe’s fees, minus refunds.
        </p>
        <p className="text-sm text-muted-foreground">
          <strong className="font-medium text-foreground">Invoices:</strong> the agent can issue an invoice through your Stripe only after you press Approve on a card showing the recipient, amount and due date. The customer pays on Stripe’s page; PBOS never charges anyone. This needs the key to have Write access to Customers, Invoices and Invoice items.
          {' '}<strong className="font-medium text-foreground">Automatic updates:</strong> {connection.webhook_id ? `on${connection.webhook_last_event_at ? `, last event ${formatDate(connection.webhook_last_event_at)}` : ', no event received yet'}. Paid, overdue and voided invoices update by themselves.` : 'off. Turn it on (needs Webhook endpoints Write on the key) so invoices flip to Paid on their own.'}
        </p>
        {connection.last_error ? <p className="text-sm text-destructive">{connection.last_error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {connection.webhook_id ? null : <ActionButton action={setupStripeWebhookAction} pendingLabel="Turning on…" variant="outline">Turn on invoice updates</ActionButton>}
          <ActionButton action={syncStripeAction} pendingLabel="Syncing…" variant="outline">Sync now</ActionButton>
          <ActionButton action={disconnectStripeAction} pendingLabel="Disconnecting…" variant="ghost" confirm="Disconnect Stripe? The saved key is deleted and the payments imported from Stripe are removed from Revenue. Your manual invoices stay.">Disconnect</ActionButton>
        </div>
      </div>
    );
  }
  return (
    <div className="surface space-y-4 p-5">
      <p className="text-sm text-muted-foreground">
        Show the payments you receive on Stripe next to your invoices. Create a <strong className="font-medium text-foreground">restricted key</strong> in Stripe with <strong className="font-medium text-foreground">Read</strong> access to <strong className="font-medium text-foreground">Charges</strong> (plus the optional invoice permissions below), and paste it here. Never paste your full secret key. The key is encrypted, never shown again, and you can disconnect any time.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Stripe dashboard → Developers → API keys → Create restricted key.</li>
        <li>Under Charges choose Read. To let the agent issue invoices you approve, also set Customers, Invoices, Invoice items and Webhook endpoints to Write. Leave everything else as None, and create it.</li>
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
