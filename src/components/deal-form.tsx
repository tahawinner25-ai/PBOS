'use client';

import { createDeal, deleteDeal, updateDeal } from '@/actions/deals';
import { ActionButton } from '@/components/action-button';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Options } from '@/components/options';
import { Input, Select, Textarea } from '@/components/ui/input';
import { DEAL_STAGES, STAGE_LABEL } from '@/lib/constants';
import { deliverablesToText } from '@/lib/profile-text';
import type { Deal } from '@/lib/types';

/** Create or edit a deal. Values are whatever the creator enters; nothing is predicted. */
export function DealForm({ deal, onDone }: { deal?: Deal; onDone?: () => void }) {
  const editing = Boolean(deal);
  return (
    <ActionForm
      key={deal?.updated_at ?? 'new'}
      action={editing ? updateDeal : createDeal}
      className="space-y-4"
      resetOnSuccess={!editing}
      onSuccess={() => onDone?.()}
    >
      {deal ? <input type="hidden" name="id" value={deal.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand" name="brand" required>
          <Input defaultValue={deal?.brand ?? ''} maxLength={120} />
        </Field>
        <Field label="Stage" name="stage" required>
          <Select defaultValue={deal?.stage ?? 'prospecting'}>
            {DEAL_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact name" name="contact_name">
          <Input defaultValue={deal?.contact_name ?? ''} autoComplete="off" maxLength={120} />
        </Field>
        <Field label="Contact email" name="contact_email">
          <Input type="email" defaultValue={deal?.contact_email ?? ''} autoComplete="off" inputMode="email" />
        </Field>
        <Field label="Deal value" name="value" hint="Optional. The amount you expect to invoice, in your own currency.">
          <Input type="number" inputMode="decimal" min={0} step="any" defaultValue={deal?.value ?? ''} />
        </Field>
        <Field label="Expected close date" name="expected_close_date">
          <Input type="date" defaultValue={deal?.expected_close_date ?? ''} />
        </Field>
      </div>
      <Field label="Deliverables" name="deliverables" hint="One per line, for example: 2 short videos, 1 story set.">
        <Textarea defaultValue={deal ? deliverablesToText(deal.deliverables ?? []) : ''} rows={4} maxLength={1500} />
      </Field>
      <Field label="Notes" name="notes">
        <Textarea defaultValue={deal?.notes ?? ''} rows={3} maxLength={2000} />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" pendingLabel={editing ? 'Saving…' : 'Adding…'}>
          {editing ? 'Save changes' : 'Add deal'}
        </SubmitButton>
        {deal ? (
          <ActionButton
            type="button"
            variant="outline"
            size="sm"
            confirm="Delete this deal? Linked invoices are kept."
            action={deleteDeal.bind(null, deal.id)}
            pendingLabel="Deleting…"
            onSuccess={() => onDone?.()}
          >
            Delete deal
          </ActionButton>
        ) : null}
      </div>
    </ActionForm>
  );
}
