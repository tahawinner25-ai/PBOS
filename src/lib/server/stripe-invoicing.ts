import 'server-only';
import { verifyStripeSignature } from '@/lib/billing';
import { siteUrl } from '@/lib/env';
import { decryptToken, encryptToken, tokenAad, parseKeyring, type Keyring } from '@/lib/integrations/crypto';
import { INVOICE_DAYS, INVOICE_EVENTS, invoiceUpdate, isHttpsUrl, isInvoiceId, majorToMinor, type StripeInvoiceObject } from '@/lib/stripe-invoice';
import { isEmailAddress } from '@/lib/email-address';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripeAs, StripeError } from './stripe';

/**
 * Invoices issued through a creator's OWN Stripe account, and the webhook that keeps them up to date.
 * The key is the creator's restricted key (stored encrypted, bound to them). PBOS only creates, finalizes and sends an invoice
 * that the customer pays on Stripe's own page. It never charges, refunds or deletes anything.
 */

const AAD = 'stripe';
const ring = (): Keyring | null => { try { return parseKeyring({ keys: process.env.TOKEN_ENCRYPTION_KEYS, single: process.env.TOKEN_ENCRYPTION_KEY }); } catch { return null; } };

const NEEDS_WRITE = 'That Stripe key is not allowed to do this. In Stripe, edit the restricted key and set Customers, Invoices and Invoice items to “Write” (and Webhook endpoints to “Write” for automatic updates). Leave everything else as it is.';

const friendly = (e: unknown): string => {
  if (e instanceof StripeError) {
    if (e.status === 401 || e.code === 'api_key_expired') return 'Stripe did not accept the saved key. Disconnect Stripe and connect it again.';
    if (e.status === 403 || e.code === 'permission_error') return NEEDS_WRITE;
    if (e.status === 429) return 'Stripe is busy right now. Try again in a minute.';
    if (e.status >= 400 && e.status < 500) return `Stripe refused the request (${e.code}). Nothing was charged.`;
  }
  return 'Stripe could not be reached right now. Try again in a moment. Nothing was charged.';
};

async function loadKey(creatorId: string): Promise<{ key: string; livemode: boolean } | { error: string }> {
  const admin = createAdminClient();
  const keys = ring();
  if (!admin || !keys) return { error: 'Stripe is not set up on this server.' };
  const row = await admin.from('stripe_connections').select('key_enc, livemode, status').eq('creator_id', creatorId).maybeSingle();
  if (row.error) return { error: 'Could not read the Stripe connection. Try again.' };
  if (!row.data) return { error: 'Stripe is not connected. Connect it on the Revenue page first.' };
  if ((row.data as { status: string }).status !== 'active') return { error: 'The Stripe connection needs attention. Fix it on the Revenue page first.' };
  try { return { key: decryptToken(String((row.data as { key_enc: string }).key_enc), keys, tokenAad(creatorId, AAD, 'key_enc')), livemode: Boolean((row.data as { livemode: boolean }).livemode) }; }
  catch { return { error: 'The saved Stripe key could not be read. Disconnect and connect again.' }; }
}

/* ── issuing ───────────────────────────────────────────────────────────── */

export type IssueExpect = { to: string; amount: number; currency: string };
export type IssueOutcome = { ok: true; message: string } | { ok: false; error: string };

/**
 * Creates, finalizes and sends the Stripe invoice for a PBOS invoice. Runs only after the creator pressed Approve. The recipient,
 * amount and currency on the card must still match the records, otherwise nothing is created. Safe to repeat: Stripe idempotency keys
 * are derived from the PBOS invoice id, so a retry returns the same invoice instead of a second one.
 */
export async function issueStripeInvoice(creatorId: string, invoiceId: string, days: number, expect: IssueExpect): Promise<IssueOutcome> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: 'The server key is not set, so nothing was issued.' };
  const d = Math.min(Math.max(Math.trunc(days) || INVOICE_DAYS.default, INVOICE_DAYS.min), INVOICE_DAYS.max);

  const found = await admin.from('revenue_entries').select('id, amount, currency, status, deal_id, source, stripe_invoice_id, notes').eq('id', invoiceId).eq('creator_id', creatorId).maybeSingle();
  if (found.error) return { ok: false, error: 'Could not read the invoice. Nothing was issued.' };
  const inv = found.data as { id: string; amount: number | string; currency: string; status: string; deal_id: string | null; source: string; stripe_invoice_id: string | null; notes: string | null } | null;
  if (!inv) return { ok: false, error: 'That invoice no longer exists. Nothing was issued.' };
  if (inv.source !== 'manual') return { ok: false, error: 'That row came from Stripe already. Nothing was issued.' };
  if (inv.status === 'paid') return { ok: false, error: 'That invoice is already marked paid, so nothing was issued.' };
  if (inv.stripe_invoice_id) return { ok: false, error: 'This invoice was already issued through Stripe. Nothing new was created.' };
  if (!inv.deal_id) return { ok: false, error: 'That invoice is not linked to a deal, so there is no brand contact to send it to.' };

  const deal = await admin.from('deals').select('brand, contact_name, contact_email').eq('id', inv.deal_id).eq('creator_id', creatorId).maybeSingle();
  if (deal.error || !deal.data) return { ok: false, error: 'The deal for this invoice was not found. Nothing was issued.' };
  const contact = deal.data as { brand: string | null; contact_name: string | null; contact_email: string | null };
  const email = contact.contact_email?.trim().toLowerCase() ?? '';
  if (!isEmailAddress(email)) return { ok: false, error: 'The deal has no valid contact email. Add one on the Deals page, then try again.' };

  const amount = Number(inv.amount);
  const currency = inv.currency.toUpperCase();
  if (email !== expect.to.toLowerCase() || currency !== expect.currency.toUpperCase() || Math.abs(amount - expect.amount) > 1e-9) {
    return { ok: false, error: 'The invoice or the contact changed after you were shown this card, so nothing was issued. Ask again to get a fresh card.' };
  }
  const minor = majorToMinor(amount, currency);
  if (minor === null) return { ok: false, error: 'That amount cannot be sent to Stripe exactly. Nothing was issued.' };

  const k = await loadKey(creatorId);
  if ('error' in k) return { ok: false, error: k.error };

  const label = (contact.brand || contact.contact_name || 'your client').slice(0, 80);
  try {
    const existing = await stripeAs<{ data: Array<{ id: string }> }>(k.key, 'GET', '/customers', { email, limit: 1 });
    const customer = existing.data[0]?.id ?? (await stripeAs<{ id: string }>(k.key, 'POST', '/customers', { email, name: (contact.contact_name || contact.brand || email).slice(0, 120), metadata: { pbos_creator_id: creatorId } }, `pbos-cust-${creatorId}-${email}`.slice(0, 250))).id;

    const created = await stripeAs<{ id: string }>(k.key, 'POST', '/invoices', {
      customer, collection_method: 'send_invoice', days_until_due: d, currency: currency.toLowerCase(), auto_advance: false,
      pending_invoice_items_behavior: 'exclude', description: `Invoice for ${label}`.slice(0, 200), metadata: { pbos_invoice_id: inv.id, pbos_creator_id: creatorId },
    }, `pbos-inv-${inv.id}`);
    if (!isInvoiceId(created.id)) return { ok: false, error: 'Stripe returned something unexpected. Nothing was sent. Try again.' };

    await stripeAs(k.key, 'POST', '/invoiceitems', { customer, invoice: created.id, amount: minor, currency: currency.toLowerCase(), description: (inv.notes?.trim() || `Invoice for ${label}`).slice(0, 250) }, `pbos-item-${inv.id}`);
    const finalized = await stripeAs<{ id: string; hosted_invoice_url?: string | null }>(k.key, 'POST', `/invoices/${created.id}/finalize`, { auto_advance: false }, `pbos-fin-${inv.id}`);
    const url = isHttpsUrl(finalized.hosted_invoice_url) ? finalized.hosted_invoice_url : null;

    // Record the link first, so the invoice is never "lost" even if sending fails below.
    const dueDate = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
    const saved = await admin.from('revenue_entries').update({ stripe_invoice_id: created.id, stripe_invoice_url: url, status: 'invoiced', due_date: dueDate, updated_at: new Date().toISOString() }).eq('id', inv.id).eq('creator_id', creatorId);
    if (saved.error) console.error('[stripe-invoicing] could not record invoice link:', saved.error.code);

    try { await stripeAs(k.key, 'POST', `/invoices/${created.id}/send`, {}, `pbos-send-${inv.id}`); }
    catch (e) { return { ok: true, message: `The invoice was created in Stripe (${created.id}) but Stripe could not email it (${friendly(e)}). Open it in Stripe to send it.` }; }
    return { ok: true, message: `Invoice issued through your Stripe and sent to ${email}. They pay on Stripe’s page${k.livemode ? '' : ' (test mode: Stripe does not really email test invoices)'}; PBOS marks it paid when Stripe says so.` };
  } catch (e) {
    console.error('[stripe-invoicing] issue failed:', e instanceof StripeError ? `${e.status} ${e.code}` : 'error');
    return { ok: false, error: friendly(e) };
  }
}

/* ── webhook registration ──────────────────────────────────────────────── */

export const creatorWebhookUrl = (creatorId: string) => `${siteUrl()}/api/webhooks/stripe-creator/${creatorId}`;

/** Makes sure the creator's Stripe sends invoice events to PBOS. Needs the key to have "Webhook endpoints: Write". */
export async function ensureCreatorWebhook(creatorId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const admin = createAdminClient();
  const keys = ring();
  if (!admin || !keys) return { ok: false, error: 'Stripe is not set up on this server.' };
  const k = await loadKey(creatorId);
  if ('error' in k) return { ok: false, error: k.error };
  if (!creatorWebhookUrl(creatorId).startsWith('https://')) return { ok: false, error: 'Stripe only sends webhooks to https addresses, and this deployment has none set.' };

  const cur = await admin.from('stripe_connections').select('webhook_id').eq('creator_id', creatorId).maybeSingle();
  const existingId = (cur.data as { webhook_id: string | null } | null)?.webhook_id ?? null;
  try {
    if (existingId) {
      try { await stripeAs(k.key, 'GET', `/webhook_endpoints/${existingId}`); return { ok: true, message: 'Invoice updates are already on.' }; }
      catch (e) { if (!(e instanceof StripeError) || e.status !== 404) throw e; }
    }
    const made = await stripeAs<{ id: string; secret?: string }>(k.key, 'POST', '/webhook_endpoints', { url: creatorWebhookUrl(creatorId), enabled_events: [...INVOICE_EVENTS], description: 'PBOS invoice updates' });
    if (typeof made.id !== 'string' || typeof made.secret !== 'string' || !made.secret.startsWith('whsec_')) return { ok: false, error: 'Stripe did not return a signing secret. Try again.' };
    const saved = await admin.from('stripe_connections').update({ webhook_id: made.id, webhook_secret_enc: encryptToken(made.secret, keys, tokenAad(creatorId, AAD, 'webhook_secret_enc')), updated_at: new Date().toISOString() }).eq('creator_id', creatorId);
    if (saved.error) {
      await stripeAs(k.key, 'DELETE', `/webhook_endpoints/${made.id}`).catch(() => undefined); // do not leave an endpoint whose secret we could not keep
      return { ok: false, error: 'Could not save the webhook. Nothing was changed. Try again.' };
    }
    return { ok: true, message: 'Invoice updates are on: Stripe now tells PBOS when an invoice is paid, overdue or voided.' };
  } catch (e) { return { ok: false, error: friendly(e) }; }
}

/** Removes the endpoint from the creator's Stripe (best effort) when they disconnect. */
export async function removeCreatorWebhook(creatorId: string): Promise<void> {
  const admin = createAdminClient();
  if (!admin) return;
  const row = await admin.from('stripe_connections').select('webhook_id').eq('creator_id', creatorId).maybeSingle();
  const id = (row.data as { webhook_id: string | null } | null)?.webhook_id;
  if (!id) return;
  const k = await loadKey(creatorId);
  if ('error' in k) return;
  await stripeAs(k.key, 'DELETE', `/webhook_endpoints/${id}`).catch(() => undefined);
}

/* ── receiving ─────────────────────────────────────────────────────────── */

const EVENTS = new Set<string>(INVOICE_EVENTS);

/**
 * Verifies and applies one delivery from a creator's Stripe. The signature is checked over the raw body with that creator's own
 * signing secret; the invoice is then re-read from Stripe with their key, so a forged or replayed body cannot change anything.
 * Returns the HTTP status to answer with (5xx makes Stripe retry).
 */
export async function handleCreatorWebhook(creatorId: string, raw: string, signature: string | null): Promise<number> {
  const admin = createAdminClient();
  const keys = ring();
  if (!admin || !keys) return 503;
  const conn = await admin.from('stripe_connections').select('webhook_secret_enc, livemode').eq('creator_id', creatorId).maybeSingle();
  if (conn.error) return 500;
  const row = conn.data as { webhook_secret_enc: string | null; livemode: boolean } | null;
  if (!row?.webhook_secret_enc) return 400;
  let secret: string;
  try { secret = decryptToken(row.webhook_secret_enc, keys, tokenAad(creatorId, AAD, 'webhook_secret_enc')); } catch { return 500; }
  if (!(await verifyStripeSignature(raw, signature, secret, Math.floor(Date.now() / 1000)))) return 400;

  let event: { type?: string; livemode?: boolean; data?: { object?: StripeInvoiceObject } };
  try { event = JSON.parse(raw); } catch { return 400; }
  if (typeof event.type !== 'string' || !EVENTS.has(event.type)) return 200;
  if (event.livemode !== row.livemode) return 200;
  const id = event.data?.object?.id;
  if (!isInvoiceId(id)) return 200;

  const mine = await admin.from('revenue_entries').select('id, status').eq('creator_id', creatorId).eq('stripe_invoice_id', id).maybeSingle();
  if (mine.error) return 500;
  await admin.from('stripe_connections').update({ webhook_last_event_at: new Date().toISOString() }).eq('creator_id', creatorId);
  if (!mine.data) return 200; // an invoice PBOS did not issue: not ours to touch

  const k = await loadKey(creatorId);
  if ('error' in k) return 200;
  let live: StripeInvoiceObject;
  try { live = await stripeAs<StripeInvoiceObject>(k.key, 'GET', `/invoices/${id}`); } catch (e) { return e instanceof StripeError && e.status === 404 ? 200 : 500; }
  const update = invoiceUpdate(live, Math.floor(Date.now() / 1000));
  const current = (mine.data as { id: string; status: string }).status;
  if (!update) return 200;
  if ('voided' in update) {
    const note = await admin.from('revenue_entries').select('notes').eq('id', (mine.data as { id: string }).id).maybeSingle();
    const prev = String((note.data as { notes: string | null } | null)?.notes ?? '');
    if (!prev.includes('(voided in Stripe)')) await admin.from('revenue_entries').update({ notes: `${prev} (voided in Stripe)`.trim().slice(0, 500), updated_at: new Date().toISOString() }).eq('id', (mine.data as { id: string }).id);
    return 200;
  }
  if (current === 'paid' && update.status !== 'paid') return 200; // never move a paid invoice backwards
  const patch = update.status === 'paid' ? { status: 'paid', paid_at: update.paid_at } : { status: update.status };
  const up = await admin.from('revenue_entries').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', (mine.data as { id: string }).id).eq('creator_id', creatorId);
  return up.error ? 500 : 200;
}
