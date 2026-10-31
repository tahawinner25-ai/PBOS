/**
 * Pure rules for deleting and exporting an account. No I/O here, so every rule is unit-tested
 * (tests/account.test.ts). The server action and the export route are thin wrappers around this.
 */

/** What the creator types to confirm deletion. Exact match after trimming, case-sensitive on purpose. */
export const DELETE_PHRASE = 'DELETE';

export function deletionConfirmed(input: unknown): boolean {
  return typeof input === 'string' && input.trim() === DELETE_PHRASE;
}

/** Storage buckets that hold per-creator files. Each object lives under `<clerk user id>/`. */
export const STORAGE_BUCKETS = ['creator-media', 'creator-assets'] as const;

/**
 * Clerk user ids look like `user_2abc…`. Storage deletion lists everything under `<id>/`, and an empty or
 * malformed id would list the root of the bucket, which belongs to everyone. So the id is validated
 * before any storage call is made.
 */
const CLERK_ID = /^user_[A-Za-z0-9]{8,64}$/;
export function isSafeStorageFolder(userId: unknown): userId is string {
  return typeof userId === 'string' && CLERK_ID.test(userId);
}

/** A storage object path is deletable only if it sits inside the creator's own folder and cannot climb out of it. */
export function isOwnStoragePath(userId: string, path: string): boolean {
  if (!isSafeStorageFolder(userId)) return false;
  if (!path.startsWith(`${userId}/`)) return false;
  return !path.split('/').some((part) => part === '..' || part === '.' || part === '');
}

/** One table of the export: which table, and which columns may leave the database. */
export type ExportTable = { key: string; table: string; columns: string; orderBy: string };

/**
 * Everything the creator owns, minus secrets. Token columns on `social_connections` and the resumable
 * upload session on `publish_jobs` are deliberately absent (they are also unreadable to the signed-in role).
 */
export const EXPORT_TABLES: readonly ExportTable[] = [
  { key: 'ideas', table: 'ideas', columns: '*', orderBy: 'created_at' },
  { key: 'posts', table: 'posts', columns: '*', orderBy: 'created_at' },
  { key: 'deals', table: 'deals', columns: '*', orderBy: 'created_at' },
  { key: 'invoices_and_revenue', table: 'revenue_entries', columns: '*', orderBy: 'created_at' },
  { key: 'media_kit_inquiries', table: 'inquiries', columns: '*', orderBy: 'created_at' },
  { key: 'agent_log', table: 'agent_events', columns: '*', orderBy: 'created_at' },
  {
    key: 'publish_jobs',
    table: 'publish_jobs',
    columns:
      'id,batch_id,platform,format,title,caption,tags,privacy,made_for_kids,scheduled_for,media_asset_ids,idea_id,post_id,status,approved_at,progress,attempts,next_attempt_at,external_id,external_url,last_error,error_code,published_at,created_at,updated_at',
    orderBy: 'created_at',
  },
  { key: 'media_library', table: 'media_assets', columns: '*', orderBy: 'created_at' },
  { key: 'ad_drafts', table: 'ad_creatives', columns: '*', orderBy: 'created_at' },
  { key: 'platform_numbers', table: 'analytics_points', columns: '*', orderBy: 'day' },
  {
    key: 'connected_accounts',
    table: 'social_connections',
    columns: 'id,platform,external_account_id,username,display_name,scopes,status,connected_at,last_synced_at,last_error',
    orderBy: 'connected_at',
  },
  { key: 'connection_events', table: 'integration_events', columns: '*', orderBy: 'created_at' },
  { key: 'usage_counters', table: 'api_usage', columns: '*', orderBy: 'day' },
];

/** Rows per table in one export. A table that hits the cap is flagged so the file never silently looks complete. */
export const EXPORT_ROW_CAP = 5000;

export type TableResult = { rows: unknown[] } | { error: string };

export type ExportFile = {
  exported_at: string;
  format: 'pbos-export-v1';
  note: string;
  profile: unknown;
  tables: Record<string, { rows: unknown[]; truncated: boolean } | { error: string }>;
};

export function exportFilename(now: Date): string {
  return `pbos-export-${now.toISOString().slice(0, 10)}.json`;
}

/** Builds the export document from per-table results. A failed table is reported, never dropped quietly. */
export function assembleExport(now: Date, profile: unknown, results: Record<string, TableResult>): ExportFile {
  const tables: ExportFile['tables'] = {};
  for (const [key, res] of Object.entries(results)) {
    if ('error' in res) tables[key] = { error: res.error };
    else tables[key] = { rows: res.rows.slice(0, EXPORT_ROW_CAP), truncated: res.rows.length >= EXPORT_ROW_CAP };
  }
  return {
    exported_at: now.toISOString(),
    format: 'pbos-export-v1',
    note: 'Your PBOS data. Access and refresh tokens for connected accounts are never included. Files in your media library are listed here; download them from the Library page.',
    profile,
    tables,
  };
}
