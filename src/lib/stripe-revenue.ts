/**
 * Reading a creator's own Stripe payments into Revenue. Pure: no network, no secrets, so it can be tested.
 *
 * Only a RESTRICTED key is accepted (rk_test_... or rk_live_...). A full secret key (sk_...) can move money, so it is refused:
 * the creator is told to make a restricted key with read access to Charges only.
 */

export type KeyMode = 'test' | 'live';

export function parseRestrictedKey(input: string): { ok: true; key: string; mode: KeyMode } | { ok: false; error: string } {
  const key = input.trim();
  if (!key) return { ok: false, error: 'Paste your Stripe restricted key.' };
  if (/^sk_(live|test)_/.test(key)) return { ok: false, error: 'That is a full secret key, which can move money. Make a restricted key instead (read access to Charges only) and paste that one. Never share the full key.' };
  if (/^pk_/.test(key)) return { ok: false, error: 'That is a publishable key. PBOS needs a restricted key that starts with rk_.' };
  const m = /^rk_(live|test)_[A-Za-z0-9]{16,250}$/.exec(key);
  if (!m) return { ok: false, error: 'That does not look like a Stripe restricted key. It starts with rk_test_ or rk_live_.' };
  return { ok: true, key, mode: m[1] as KeyMode };
}

/** Currencies Stripe counts in whole units (amount 500 JPY means 500 yen, not 5). */
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE_DECIMAL = new Set(['BHD', 'JOD', 'KWD', 'OMR', 'TND']);

export function minorToMajor(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  const div = ZERO_DECIMAL.has(c) ? 1 : THREE_DECIMAL.has(c) ? 1000 : 100;
  return Math.round((amount / div) * 1000) / 1000;
}

export type StripeCharge = {
  id?: unknown; amount?: unknown; amount_refunded?: unknown; currency?: unknown; created?: unknown;
  paid?: unknown; status?: unknown; refunded?: unknown; disputed?: unknown; description?: unknown; livemode?: unknown;
};

export type RevenueRow = { external_id: string; amount: number; currency: string; paid_at: string; notes: string };

const dayOf = (unix: number): string => new Date(unix * 1000).toISOString().slice(0, 10);

/**
 * One Stripe charge as a revenue row, or null when it is not money received (failed, pending, fully refunded, malformed).
 * The amount is what was charged minus what was refunded, before Stripe's own fees.
 */
export function chargeToRow(charge: StripeCharge): RevenueRow | null {
  const { id, amount, currency, created } = charge;
  if (typeof id !== 'string' || !/^(ch|py)_[A-Za-z0-9]{6,80}$/.test(id)) return null;
  if (charge.paid !== true || charge.status !== 'succeeded') return null;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null;
  if (typeof currency !== 'string' || !/^[A-Za-z]{3}$/.test(currency)) return null;
  if (typeof created !== 'number' || !Number.isFinite(created) || created <= 0) return null;
  const refunded = typeof charge.amount_refunded === 'number' && Number.isFinite(charge.amount_refunded) ? charge.amount_refunded : 0;
  const net = amount - refunded;
  if (net <= 0) return null;
  const cur = currency.toUpperCase();
  const what = typeof charge.description === 'string' && charge.description.trim() ? charge.description.replace(/\s+/g, ' ').trim().slice(0, 120) : 'Stripe payment';
  const notes = `${what}${refunded > 0 ? ' (partly refunded)' : ''}${charge.disputed === true ? ' (disputed)' : ''}`.slice(0, 200);
  return { external_id: id, amount: minorToMajor(net, cur), currency: cur, paid_at: dayOf(created), notes };
}

/** Charges that no longer count (refunded in full) so their rows can be removed. */
export function chargeIsGone(charge: StripeCharge): string | null {
  const id = charge.id;
  if (typeof id !== 'string') return null;
  if (typeof charge.amount === 'number' && typeof charge.amount_refunded === 'number' && charge.amount > 0 && charge.amount_refunded >= charge.amount) return id;
  return null;
}
