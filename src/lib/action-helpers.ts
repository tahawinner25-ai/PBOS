import 'server-only';
import { getCreatorContext, type CreatorContext } from '@/lib/auth';
import type { ActionResult } from '@/lib/types';

export const ok = (message?: string): { ok: true; message?: string } => ({ ok: true, message });

export const fail = (
  error: string,
  fieldErrors?: Record<string, string>,
): { ok: false; error: string; fieldErrors?: Record<string, string> } => ({ ok: false, error, fieldErrors });

/** Log the real database error on the server; show the creator a safe message. */
export function dbFail(label: string, error: { message: string; code?: string }) {
  console.error(`[db] ${label}: ${error.code ?? ''} ${error.message}`);
  return fail('Could not save to the database. Nothing was changed. Try again in a moment.');
}

/**
 * Runs an action for the signed-in creator. Returns a friendly error when signed out and
 * converts unexpected exceptions into a generic message (the details go to the server log).
 * Do not call redirect() inside `fn`: the catch below would swallow it.
 */
export async function withCreator<T = undefined>(
  fn: (ctx: CreatorContext) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  try {
    const ctx = await getCreatorContext();
    if (!ctx) return fail('You are signed out, or this account has no creator profile yet. Sign in again.');
    return await fn(ctx);
  } catch (err) {
    console.error('[action]', err);
    return fail('Something went wrong on the server. Nothing was changed. Try again.');
  }
}
