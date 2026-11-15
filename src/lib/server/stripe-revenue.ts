import 'server-only';
import { chargeIsGone, chargeToRow, parseRestrictedKey, type StripeCharge } from '@/lib/stripe-revenue';
import { decryptToken, encryptToken, tokenAad, parseKeyring, type Keyring } from '@/lib/integrations/crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripeAs, StripeError } from './stripe';

/**
 * Reads a creator's own Stripe charges into their Revenue page. Read-only: the key is a restricted key that can only list charges,
 * it is stored encrypted (bound to this creator), and it never appears in a log, an error or a response.
 */

const AAD_PLATFORM = 'stripe';
const AAD_COLUMN = 'key_enc';
const SYNC_DAYS = 90;
const PAGES = 3; // up to 300 charges per sync
const DEBOUNCE_MS = 60_000;

function ring(): Keyring | null {
  try { return parseKeyring({ keys: process.env.TOKEN_ENCRYPTION_KEYS, single: process.env.TOKEN_ENCRYPTION_KEY }); } catch { return null; }
}

export type SyncOutcome = { ok: true; imported: number; removed: number; message: string } | { ok: false; error: string };

const friendly = (e: unknown): string => {
  if (e instanceof StripeError) {
    if (e.status === 401 || e.code === 'api_key_expired') return 'Stripe did not accept that key. It may be wrong, expired or deleted.';
    if (e.status === 403 || e.code === 'permission_error') return 'That key cannot read Charges. In Stripe, edit the restricted key and give Charges “Read” access.';
    if (e.status === 429) return 'Stripe is busy right now. Try again in a minute.';
  }
  return 'Stripe could not be reached right now. Nothing was changed. Try again in a moment.';
};

type ChargeList = { data: StripeCharge[]; has_more?: boolean };

async function pullCharges(key: string): Promise<StripeCharge[]> {
  const since = Math.floor(Date.now() / 1000) - SYNC_DAYS * 86400;
  const out: StripeCharge[] = [];
  let after: string | undefined;
  for (let page = 0; page < PAGES; page++) {
    const res = await stripeAs<ChargeList>(key, 'GET', '/charges', { limit: 100, 'created[gte]': since, ...(after ? { starting_after: after } : {}) });
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) break;
    const last = res.data[res.data.length - 1]?.id;
    if (typeof last !== 'string') break;
    after = last;
  }
  return out;
}

async function importCharges(creatorId: string, charges: StripeCharge[]): Promise<{ imported: number; removed: number } | { error: string }> {
  const admin = createAdminClient();
  if (!admin) return { error: 'The server key is not set, so Stripe revenue cannot be saved.' };
  const rows = charges.map(chargeToRow).filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length) {
    const up = await admin.from('revenue_entries').upsert(
      rows.map((r) => ({ creator_id: creatorId, amount: r.amount, currency: r.currency, status: 'paid', paid_at: r.paid_at, notes: r.notes, source: 'stripe', external_id: r.external_id, is_demo: false })),
      { onConflict: 'creator_id,external_id' },
    );
    if (up.error) { console.error('[stripe-revenue] upsert failed:', up.error.code); return { error: 'Could not save the Stripe payments. Nothing was lost. Try again.' }; }
  }
  const gone = charges.map(chargeIsGone).filter((x): x is string => x !== null);
  let removed = 0;
  if (gone.length) {
    const del = await admin.from('revenue_entries').delete({ count: 'exact' }).eq('creator_id', creatorId).eq('source', 'stripe').in('external_id', gone);
    if (del.error) console.error('[stripe-revenue] remove refunded failed:', del.error.code);
    else removed = del.count ?? 0;
  }
  return { imported: rows.length, removed };
}

/** Checks the key against Stripe, stores it encrypted, and pulls the first payments. */
export async function connectStripe(creatorId: string, rawKey: string): Promise<SyncOutcome> {
  const parsed = parseRestrictedKey(rawKey);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const keys = ring();
  const admin = createAdminClient();
  if (!keys || !admin) return { ok: false, error: 'Connecting Stripe is not set up on this server yet (the encryption key is missing).' };

  let charges: StripeCharge[];
  try { charges = await pullCharges(parsed.key); } catch (e) { return { ok: false, error: friendly(e) }; }

  const saved = await admin.from('stripe_connections').upsert({
    creator_id: creatorId,
    key_enc: encryptToken(parsed.key, keys, tokenAad(creatorId, AAD_PLATFORM, AAD_COLUMN)),
    livemode: parsed.mode === 'live', status: 'active', last_error: null, updated_at: new Date().toISOString(),
  }, { onConflict: 'creator_id' });
  if (saved.error) { console.error('[stripe-revenue] save failed:', saved.error.code); return { ok: false, error: 'Could not save the connection. Nothing was changed. Try again.' }; }

  const result = await importCharges(creatorId, charges);
  if ('error' in result) return { ok: false, error: result.error };
  await admin.from('stripe_connections').update({ last_synced_at: new Date().toISOString(), charges_seen: result.imported }).eq('creator_id', creatorId);
  return { ok: true, ...result, message: `Connected to Stripe (${parsed.mode} mode). ${result.imported} payment${result.imported === 1 ? '' : 's'} from the last ${SYNC_DAYS} days ${result.imported === 1 ? 'was' : 'were'} added to Revenue.` };
}

/** Pulls the latest payments with the stored key. Safe to repeat: rows are matched by Stripe's charge id. */
export async function syncStripe(creatorId: string): Promise<SyncOutcome> {
  const admin = createAdminClient();
  const keys = ring();
  if (!admin || !keys) return { ok: false, error: 'Stripe revenue is not set up on this server.' };
  const row = await admin.from('stripe_connections').select('key_enc, last_synced_at').eq('creator_id', creatorId).maybeSingle();
  if (row.error) { console.error('[stripe-revenue] read failed:', row.error.code); return { ok: false, error: 'Could not read the Stripe connection. Try again.' }; }
  if (!row.data) return { ok: false, error: 'Stripe is not connected yet.' };
  const last = row.data.last_synced_at ? Date.parse(String(row.data.last_synced_at)) : 0;
  if (Date.now() - last < DEBOUNCE_MS) return { ok: true, imported: 0, removed: 0, message: 'Already up to date.' };

  let key: string;
  try { key = decryptToken(String(row.data.key_enc), keys, tokenAad(creatorId, AAD_PLATFORM, AAD_COLUMN)); }
  catch { console.error('[stripe-revenue] cannot decrypt stored key'); return { ok: false, error: 'The saved Stripe key could not be read. Disconnect and connect again.' }; }

  let charges: StripeCharge[];
  try { charges = await pullCharges(key); }
  catch (e) {
    const msg = friendly(e);
    if (e instanceof StripeError && (e.status === 401 || e.status === 403)) await admin.from('stripe_connections').update({ status: 'invalid', last_error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq('creator_id', creatorId);
    return { ok: false, error: msg };
  }
  const result = await importCharges(creatorId, charges);
  if ('error' in result) return { ok: false, error: result.error };
  await admin.from('stripe_connections').update({ status: 'active', last_error: null, last_synced_at: new Date().toISOString(), charges_seen: result.imported, updated_at: new Date().toISOString() }).eq('creator_id', creatorId);
  return { ok: true, ...result, message: `Synced. ${result.imported} payment${result.imported === 1 ? '' : 's'} from the last ${SYNC_DAYS} days.` };
}

/** Forgets the key and removes the payments that came from Stripe. Manual invoices are untouched. */
export async function disconnectStripe(creatorId: string): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();
  if (!admin) return { ok: false, error: 'The server key is not set.' };
  const del = await admin.from('revenue_entries').delete().eq('creator_id', creatorId).eq('source', 'stripe');
  if (del.error) { console.error('[stripe-revenue] clear failed:', del.error.code); return { ok: false, error: 'Could not remove the imported payments. Nothing was disconnected.' }; }
  const drop = await admin.from('stripe_connections').delete().eq('creator_id', creatorId);
  if (drop.error) { console.error('[stripe-revenue] disconnect failed:', drop.error.code); return { ok: false, error: 'Could not disconnect. Try again.' }; }
  return { ok: true };
}
