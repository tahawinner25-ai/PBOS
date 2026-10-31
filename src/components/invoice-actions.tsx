'use client';

import { useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import { deleteInvoice, setInvoiceStatus } from '@/actions/revenue';
import { ActionButton } from '@/components/action-button';
import { DraftSheet } from '@/components/draft-sheet';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { callGenerate } from '@/lib/client-generate';
import type { FollowupDraft } from '@/lib/generate/validators';

type Followups = { drafts: FollowupDraft[]; suggested_level: 1 | 2 | 3 };

/**
 * Row actions for one invoice. For an overdue invoice the creator can generate three escalating
 * follow-up drafts. They are for the creator to copy, edit and send; PBOS never emails anyone.
 */
export function InvoiceActions({ invoiceId, paid, overdue, brand }: { invoiceId: string; paid: boolean; overdue: boolean; brand: string | null }) {
  const [result, setResult] = useState<{ data: Followups; source: 'ai' | 'template'; notice: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const res = await callGenerate<Followups>({ kind: 'followups', invoice_id: invoiceId });
    if (res.ok) setResult({ data: res.result, source: res.source, notice: res.notice });
    else setError(res.error);
    busy.current = false;
    setPending(false);
  }

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {!paid ? (
          <ActionButton size="sm" action={setInvoiceStatus.bind(null, invoiceId, 'paid')} pendingLabel="Saving…">
            Mark as paid
          </ActionButton>
        ) : (
          <ActionButton size="sm" variant="outline" action={setInvoiceStatus.bind(null, invoiceId, 'invoiced')} pendingLabel="Saving…">
            Mark as unpaid
          </ActionButton>
        )}
        {overdue ? (
          <Button type="button" size="sm" variant="outline" onClick={generate} disabled={pending} aria-busy={pending}>
            <Mail aria-hidden="true" />
            {pending ? 'Drafting…' : result ? 'Redraft follow-ups' : 'Draft follow-ups'}
          </Button>
        ) : null}
        <ActionButton size="sm" variant="ghost" confirm="Delete this invoice?" action={deleteInvoice.bind(null, invoiceId)} pendingLabel="Deleting…">
          Delete
        </ActionButton>
      </div>

      {error ? <Alert variant="destructive" title={error} /> : null}

      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Three drafts, from gentle to firm{brand ? ` for ${brand}` : ''}. Based on how late this invoice is, level {result.data.suggested_level} is the suggested one to send first.
            Nothing is sent for you.
          </p>
          {result.data.drafts.map((d) => (
            <DraftSheet key={d.level} title={`Level ${d.level}: ${d.label}`} subject={d.subject} body={d.body} source={result.source} notice={result.notice}>
              {d.level === result.data.suggested_level ? <Badge variant="default">Suggested for now</Badge> : null}
            </DraftSheet>
          ))}
        </div>
      ) : null}
    </div>
  );
}
