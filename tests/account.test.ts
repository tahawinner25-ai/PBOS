import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assembleExport, deletionConfirmed, EXPORT_ROW_CAP, EXPORT_TABLES, exportFilename, isOwnStoragePath, isSafeStorageFolder } from '../src/lib/account';
import { removeUserFolder, type StorageBucketApi } from '../src/lib/account-storage';

const USER = 'user_2abcDEF12345xyz';

describe('deletion confirmation', () => {
  it('accepts only the exact word', () => {
    assert.equal(deletionConfirmed('DELETE'), true);
    assert.equal(deletionConfirmed('  DELETE  '), true);
    for (const bad of ['delete', 'Delete', 'DELETE ME', '', 'DELET', null, undefined, 42, {}]) assert.equal(deletionConfirmed(bad), false, String(bad));
  });
});

describe('storage folder safety', () => {
  it('accepts Clerk ids and rejects anything that could list a whole bucket', () => {
    assert.equal(isSafeStorageFolder(USER), true);
    for (const bad of ['', '/', '.', '..', 'user_', 'user_a', 'abc', `${USER}/`, `${USER}/../other`, 'user_2abc DEF', null, undefined, 7]) assert.equal(isSafeStorageFolder(bad), false, String(bad));
  });
  it('only allows paths inside the creator folder', () => {
    assert.equal(isOwnStoragePath(USER, `${USER}/a.jpg`), true);
    assert.equal(isOwnStoragePath(USER, `${USER}/sub/a.jpg`), true);
    assert.equal(isOwnStoragePath(USER, `user_2otherOTHER99/a.jpg`), false);
    assert.equal(isOwnStoragePath(USER, `${USER}/../user_2otherOTHER99/a.jpg`), false);
    assert.equal(isOwnStoragePath(USER, `${USER}//a.jpg`), false);
    assert.equal(isOwnStoragePath(USER, `${USER}`), false);
    assert.equal(isOwnStoragePath('', '/a.jpg'), false);
  });
});

/** In-memory bucket: files keyed by full path; folders are derived like Supabase does (null id). */
function fakeBucket(files: string[], opts: { failRemove?: boolean } = {}) {
  const store = new Set(files);
  const removedCalls: string[][] = [];
  const api: StorageBucketApi = {
    async list(prefix, { limit, offset }) {
      const seen = new Map<string, string | null>();
      for (const f of [...store].sort()) {
        if (!f.startsWith(`${prefix}/`)) continue;
        const rest = f.slice(prefix.length + 1);
        const [head, ...tail] = rest.split('/');
        if (tail.length === 0) seen.set(head, 'id-' + f);
        else if (!seen.has(head)) seen.set(head, null);
      }
      const all = [...seen.entries()].map(([name, id]) => ({ name, id }));
      return { data: all.slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      if (opts.failRemove) return { error: { message: 'boom' } };
      removedCalls.push(paths);
      for (const p of paths) store.delete(p);
      return { error: null };
    },
  };
  return { api, store, removedCalls };
}

describe('removeUserFolder', () => {
  it('deletes nested files and more than one page, and leaves other creators alone', async () => {
    const mine = Array.from({ length: 230 }, (_, i) => `${USER}/f${i}.jpg`).concat([`${USER}/clips/a.mp4`, `${USER}/clips/deep/b.mp4`]);
    const theirs = ['user_2otherOTHER99/keep.jpg', 'user_2otherOTHER99/x/keep2.jpg'];
    const b = fakeBucket([...mine, ...theirs]);
    const res = await removeUserFolder(b.api, USER);
    assert.equal(res.removed, mine.length);
    assert.deepEqual([...b.store].sort(), [...theirs].sort());
  });
  it('is a no-op for an empty folder', async () => {
    const b = fakeBucket(['user_2otherOTHER99/keep.jpg']);
    assert.equal((await removeUserFolder(b.api, USER)).removed, 0);
    assert.equal(b.store.size, 1);
  });
  it('refuses an unsafe id before touching storage', async () => {
    const b = fakeBucket(['user_2otherOTHER99/keep.jpg']);
    for (const bad of ['', '.', '..', 'x']) await assert.rejects(removeUserFolder(b.api, bad), /invalid user id/);
    assert.equal(b.store.size, 1);
    assert.equal(b.removedCalls.length, 0);
  });
  it('stops with an error when storage fails, so the caller does not delete database rows', async () => {
    const b = fakeBucket([`${USER}/a.jpg`], { failRemove: true });
    await assert.rejects(removeUserFolder(b.api, USER), /storage remove failed/);
  });
  it('does not loop forever when the listing never shrinks', async () => {
    const stuck: StorageBucketApi = {
      async list() { return { data: [{ name: 'ghost.jpg', id: 'x' }], error: null }; },
      async remove() { return { error: null }; },
    };
    const res = await removeUserFolder(stuck, USER);
    assert.ok(res.removed <= 200);
  });
});

describe('export', () => {
  it('never selects token or upload-session columns', () => {
    for (const t of EXPORT_TABLES) assert.doesNotMatch(t.columns, /token|upload_session|locked_until|_enc/i, t.table);
    const conn = EXPORT_TABLES.find((t) => t.table === 'social_connections');
    assert.ok(conn && conn.columns !== '*');
    const jobs = EXPORT_TABLES.find((t) => t.table === 'publish_jobs');
    assert.ok(jobs && jobs.columns !== '*');
  });
  it('has unique keys and tables', () => {
    assert.equal(new Set(EXPORT_TABLES.map((t) => t.key)).size, EXPORT_TABLES.length);
    assert.equal(new Set(EXPORT_TABLES.map((t) => t.table)).size, EXPORT_TABLES.length);
  });
  it('reports a failed table instead of dropping it, and flags a table that hit the cap', () => {
    const full = Array.from({ length: EXPORT_ROW_CAP }, (_, i) => ({ i }));
    const out = assembleExport(new Date('2026-10-24T10:00:00Z'), { id: 'p' }, { ideas: { rows: [{ a: 1 }] }, posts: { error: 'x' }, deals: { rows: full } });
    assert.deepEqual(out.tables.ideas, { rows: [{ a: 1 }], truncated: false });
    assert.deepEqual(out.tables.posts, { error: 'x' });
    assert.equal((out.tables.deals as { truncated: boolean }).truncated, true);
    assert.equal(out.exported_at, '2026-10-24T10:00:00.000Z');
    assert.equal(out.format, 'pbos-export-v1');
  });
  it('names the file by date', () => {
    assert.equal(exportFilename(new Date('2026-10-24T23:59:00Z')), 'pbos-export-2026-10-24.json');
  });
});
