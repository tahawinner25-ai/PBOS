'use server';

import { clerkClient } from '@clerk/nextjs/server';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { deletionConfirmed, DELETE_PHRASE, STORAGE_BUCKETS } from '@/lib/account';
import { removeUserFolder } from '@/lib/account-storage';
import { disconnectPlatform } from '@/actions/connections';
import { rateLimit } from '@/lib/server/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';

/**
 * Permanently deletes the signed-in creator's account and everything PBOS holds about them.
 *
 * Order matters, and every step is safe to repeat if one fails:
 *  1. Revoke the YouTube and Instagram grants and delete their tokens (best effort at the platform;
 *     the local tokens are removed either way).
 *  2. Delete the creator's files from storage. If this fails we stop, so no file is left behind with
 *     nothing pointing at it.
 *  3. Delete the creator_profile row. Every other table references it with ON DELETE CASCADE, so
 *     ideas, posts, deals, invoices, drafts, publish jobs, analytics, usage counters and events go with it.
 *  4. Delete the sign-in account at Clerk.
 *
 * The service-role client is used only because storage objects and the Clerk user are outside the
 * creator's own row-level-security reach. Every call is scoped by the id of the signed-in creator,
 * which comes from the session, never from the request.
 */
export async function deleteAccount(confirmation: string): Promise<ActionResult> {
  return withCreator(async ({ user, profile }) => {
    if (!deletionConfirmed(confirmation)) return fail(`Type ${DELETE_PHRASE} to confirm.`, { confirmation: `Type ${DELETE_PHRASE} exactly as shown.` });
    if (!rateLimit(`account-delete:${user.id}`, 3, 60 * 60_000).allowed) return fail('Too many attempts. Try again in an hour.');

    const admin = createAdminClient();
    if (!admin) return fail('Account deletion is not available on this deployment because the server key is not set. Contact the site operator.');

    // 1. Platform grants. Errors are ignored here: a platform that already dropped the grant is fine.
    for (const platform of ['youtube', 'instagram'] as const) {
      try {
        await disconnectPlatform(platform, true);
      } catch {
        console.error(`[account] disconnect ${platform} failed; continuing with deletion`);
      }
    }

    // 2. Files.
    try {
      for (const bucket of STORAGE_BUCKETS) await removeUserFolder(admin.storage.from(bucket), user.id);
    } catch (err) {
      console.error('[account] storage cleanup failed:', err instanceof Error ? err.message : 'unknown');
      return fail('Could not delete your files. Nothing else was removed. Try again in a moment.');
    }

    // 3. Database rows.
    const del = await admin.from('creator_profile').delete().eq('id', profile.id).eq('user_id', user.id);
    if (del.error) return dbFail('deleteAccount', del.error);

    // 4. Sign-in account.
    try {
      const client = await clerkClient();
      await client.users.deleteUser(user.id);
    } catch (err) {
      console.error('[account] clerk delete failed:', err instanceof Error ? err.message : 'unknown');
      return ok('Your data is deleted. We could not remove your sign-in account automatically, so sign out and email us to finish removing it.');
    }

    console.info('[account] a creator account was deleted');
    return ok('Your account and data were deleted.');
  });
}
