/**
 * Issuing an invoice through a creator's own Stripe, and reading its status back. Pure: no network, no secrets, so it is tested.
 *
 * PBOS only creates, finalizes and sends an invoice with collection_method "send_invoice": the customer pays it on Stripe's own page.
 * Nothing here charges anyone, refunds, or deletes.
 */

const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

/** Whole minor units Stripe wants (cents). Returns null when the amount cannot be represented exactly. */
export function majorToMinor(amount: number, currency: string): number | null {
  const c = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  const mul = ZERO_DECIMAL.has(c) ? 1 : THREE_DECIMAL.has(c) ? 1000 : 100;
  const minor = Math.round(amount * mul);
  if (Math.abs(minor / mul - amount) > 1e-9 || minor < 1 || minor > 99_999_999) return null;
  return minor;
}

export const INVOICE_DAYS = { min: 1, max: 60, default: 14 } as const;

/** The Stripe events PBOS listens to on the creator's account. */
export const INVOICE_EVENTS = ['invoice.paid', 'invoice.payment_failed', 'invoice.marked_uncollectible', 'invoice.voided', 'invoice.finalized', 'invoice.updated'] as const;

export type StripeInvoiceObject = { id?: unknown; status?: unknown; due_date?: unknown; hosted_invoice_url?: unknown; status_transitions?: { paid_at?: unknown } | null; livemode?: unknown };

export type InvoiceUpdate = { status: 'paid'; paid_at: string } | { status: 'overdue' } | { status: 'invoiced' } | { voided: true } | null;

const dayOf = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

/** What PBOS should record for a Stripe invoice, judged from the invoice as Stripe reports it now. Null when there is nothing to do. */
export function invoiceUpdate(inv: StripeInvoiceObject, nowSec: number): InvoiceUpdate {
  switch (inv.status) {
    case 'paid': {
      const at = inv.status_transitions?.paid_at;
      return { status: 'paid', paid_at: dayOf(typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : nowSec) };
    }
    case 'uncollectible': return { status: 'overdue' };
    case 'void': return { voided: true };
    case 'open': return typeof inv.due_date === 'number' && inv.due_date < nowSec ? { status: 'overdue' } : { status: 'invoiced' };
    default: return null; // draft, deleted, unknown
  }
}

export const isInvoiceId = (v: unknown): v is string => typeof v === 'string' && /^in_[A-Za-z0-9]{6,80}$/.test(v);
export const isHttpsUrl = (v: unknown): v is string => typeof v === 'string' && v.length <= 500 && /^https:\/\/[^\s]+$/.test(v);
