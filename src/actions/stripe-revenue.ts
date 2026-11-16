'use server';

import { revalidatePath } from 'next/cache';
import { fail, ok, withCreator } from '@/lib/action-helpers';
import { connectStripe, disconnectStripe, syncStripe } from '@/lib/server/stripe-revenue';
import { ensureCreatorWebhook } from '@/lib/server/stripe-invoicing';
import { rateLimit } from '@/lib/server/rate-limit';
import type { ActionResult } from '@/lib/types';

const touch = () => ['/revenue', '/dashboard'].forEach((p) => revalidatePath(p));

/** Connect the creator's own Stripe account (restricted, read-only key). The key is checked, encrypted and never shown again. */
export async function connectStripeAction(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ user, profile }) => {
    if (!rateLimit(`stripe-connect:${user.id}`, 6, 60 * 60_000).allowed) return fail('Too many attempts. Try again in an hour.');
    const key = formData.get('restricted_key');
    if (typeof key !== 'string') return fail('Paste your Stripe restricted key.', { restricted_key: 'Required' });
    const r = await connectStripe(profile.id, key);
    if (!r.ok) return fail(r.error, { restricted_key: r.error });
    touch();
    return ok(r.message);
  });
}

export async function syncStripeAction(): Promise<ActionResult> {
  return withCreator(async ({ user, profile }) => {
    if (!rateLimit(`stripe-sync:${user.id}`, 20, 60 * 60_000).allowed) return fail('Too many syncs. Try again later.');
    const r = await syncStripe(profile.id);
    if (!r.ok) return fail(r.error);
    touch();
    return ok(r.message);
  });
}

/** Turns on automatic invoice updates (a webhook in the creator's own Stripe). Needs a key with Webhook endpoints write access. */
export async function setupStripeWebhookAction(): Promise<ActionResult> {
  return withCreator(async ({ user, profile }) => {
    if (!rateLimit(`stripe-webhook:${user.id}`, 10, 60 * 60_000).allowed) return fail('Too many attempts. Try again later.');
    const r = await ensureCreatorWebhook(profile.id);
    if (!r.ok) return fail(r.error);
    touch();
    return ok(r.message);
  });
}

export async function disconnectStripeAction(): Promise<ActionResult> {
  return withCreator(async ({ user, profile }) => {
    if (!rateLimit(`stripe-disconnect:${user.id}`, 10, 60 * 60_000).allowed) return fail('Too many attempts. Try again later.');
    const r = await disconnectStripe(profile.id);
    if (!r.ok) return fail(r.error ?? 'Could not disconnect.');
    touch();
    return ok('Stripe disconnected. The key was deleted and the imported payments were removed. Your manual invoices were not touched.');
  });
}
