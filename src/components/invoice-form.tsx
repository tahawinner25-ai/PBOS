'use client';

import { createInvoice } from '@/actions/revenue';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Input, Select } from '@/components/ui/input';
import { INVOICE_STATUSES } from '@/lib/constants';

const STATUS_LABEL = { invoiced: 'Invoiced', paid: 'Paid', overdue: 'Overdue' } as const;

/** Manual invoice entry. PBOS records the invoice you issued elsewhere; it does not issue or send one. */
export function InvoiceForm({ deals, defaultCurrency }: { deals: Array<{ id: string; brand: string | null }>; defaultCurrency: string }) {
  return (
    <ActionForm action={createInvoice} className="space-y-4" resetOnSuccess>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Deal" name="deal_id" hint="Optional. Links the invoice to a brand for follow-ups.">
          <Select defaultValue="">
            <option value="">Not linked</option>
            {deals.map((d) => (
              <option key={d.id} value={d.id}>
                {d.brand ?? 'Unnamed brand'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Status" name="status" required>
          <Select defaultValue="invoiced">
            {INVOICE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amount" name="amount" required>
          <Input type="number" inputMode="decimal" min={0.01} step="any" />
        </Field>
        <Field label="Currency" name="currency" hint="Three letters, such as USD or EUR.">
          <Input defaultValue={defaultCurrency} maxLength={3} autoCapitalize="characters" pattern="[A-Za-z]{3}" title="Three-letter currency code" />
        </Field>
        <Field label="Due date" name="due_date" hint="Needed for overdue checks.">
          <Input type="date" />
        </Field>
        <Field label="Paid on" name="paid_at" hint="Only for paid invoices. Defaults to today.">
          <Input type="date" />
        </Field>
      </div>
      <Field label="Notes" name="notes">
        <Input maxLength={500} />
      </Field>
      <SubmitButton size="sm" pendingLabel="Adding…">
        Add invoice
      </SubmitButton>
    </ActionForm>
  );
}
