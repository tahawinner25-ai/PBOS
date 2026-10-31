import { isOwnStoragePath, isSafeStorageFolder } from '@/lib/account';

/** The two Supabase Storage calls account deletion needs, so the walk can be tested with a fake bucket. */
export type StorageBucketApi = {
  list(path: string, options: { limit: number; offset: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>;
  remove(paths: string[]): Promise<{ error: { message: string } | null }>;
};

const PAGE = 100;
const MAX_DEPTH = 4;
const MAX_ROUNDS = 200;

/**
 * Deletes every object under `<userId>/` in one bucket, including nested folders. It lists from offset 0
 * each round because removing objects shrinks the listing. Throws on the first storage error so the
 * caller can stop before deleting the database rows (the creator can simply try again).
 *
 * Safety: the folder name is validated first, and every path is re-checked to be inside that folder
 * immediately before it is removed.
 */
export async function removeUserFolder(bucket: StorageBucketApi, userId: string): Promise<{ removed: number }> {
  if (!isSafeStorageFolder(userId)) throw new Error('Refusing to clean storage for an invalid user id.');
  let removed = 0;

  async function walk(prefix: string, depth: number): Promise<void> {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const listed = await bucket.list(prefix, { limit: PAGE, offset: 0 });
      if (listed.error) throw new Error(`storage list failed: ${listed.error.message}`);
      const entries = listed.data ?? [];
      if (entries.length === 0) return;

      // Storage lists folders with a null id.
      const files = entries.filter((e) => e.id !== null).map((e) => `${prefix}/${e.name}`);
      const folders = entries.filter((e) => e.id === null).map((e) => `${prefix}/${e.name}`);

      const deletable = files.filter((p) => isOwnStoragePath(userId, p));
      if (deletable.length > 0) {
        const res = await bucket.remove(deletable);
        if (res.error) throw new Error(`storage remove failed: ${res.error.message}`);
        removed += deletable.length;
      }
      if (depth < MAX_DEPTH) {
        for (const folder of folders) await walk(folder, depth + 1);
      }
      // Nothing was deleted this round, so another listing would return the same entries.
      if (deletable.length === 0) return;
    }
  }

  await walk(userId, 0);
  return { removed };
}
