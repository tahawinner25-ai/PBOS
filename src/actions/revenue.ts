'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { DEFAULT_CURRENCY, INVOICE_STATUSES } from '@/lib/constants';
import { todayISO } from '@/lib/dates';
import type { ActionResult } from '@/lib/types';
import { parse, rules } from '@/lib/validation';

const touch = () => ['/revenue', '/deals', '/dashboard'].forEach((p) => revalidatePath(p));

/** Manual invoice entry. PBOS tracks invoices; it does not issue them, send them or collect payment. */
export async function createInvoice(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        deal_id: rules.optionalUuid(),
        amount: rules.number({ min: 0.01, max: 1_000_000_000 }),
        currency: rules.optionalText({ max: 3 }),
        status: rules.oneOf(INVOICE_STATUSES),
        due_date: rules.optionalDate(),
        paid_at: rules.optionalDate(),
        notes: rules.optionalText({ max: 500 }),
      },
      { deal_id: 'Deal', amount: 'Amount', due_date: 'Due date', paid_at: 'Paid on' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;

    const currency = (d.currency ?? DEFAULT_CURRENCY).toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return fail('Currency must be a 3-letter code such as USD or EUR.', { currency: 'Use a 3-letter code such as USD or EUR.' });
    // A paid invoice always carries a paid date for the books; default to today when none was given.
    const paid_at = d.status === 'paid' ? (d.paid_at ?? todayISO(new Date())) : null;

    const { error } = await supabase.from('revenue_entries').insert({
      creator_id: profile.id,
      deal_id: d.deal_id,
      amount: d.amount,
      currency,
      status: d.status,
      due_date: d.due_date,
      paid_at,
      notes: d.notes,
    });
    if (error) return dbFail('createInvoice', error);
    touch();
    return ok('Invoice added.');
  });
}

export async function setInvoiceStatus(id: string, status: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const idRes = rules.uuid()(id, 'Invoice');
    if (!idRes.ok) return fail(idRes.error);
    const s = rules.oneOf(INVOICE_STATUSES)(status, 'Status');
    if (!s.ok) return fail(s.error);
    const { error } = await supabase
      .from('revenue_entries')
      .update({ status: s.value, paid_at: s.value === 'paid' ? todayISO(new Date()) : null })
      .eq('id', idRes.value)
      .eq('creator_id', profile.id);
    if (error) return dbFail('setInvoiceStatus', error);
    touch();
    return ok(s.value === 'paid' ? 'Marked as paid.' : `Marked as ${s.value}.`);
  });
}

export async function deleteInvoice(id: string): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const v = rules.uuid()(id, 'Invoice');
    if (!v.ok) return fail(v.error);
    const { error } = await supabase.from('revenue_entries').delete().eq('id', v.value).eq('creator_id', profile.id);
    if (error) return dbFail('deleteInvoice', error);
    touch();
    return ok('Invoice deleted.');
  });
}
