/** Rules for the public data-deletion status page. Pure, so they are tested without a database. */

/** Confirmation codes are 16 lowercase hex characters (8 random bytes). Anything else is not looked up. */
export const DELETION_CODE = /^[a-f0-9]{16}$/;

export function parseDeletionCode(value: unknown): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && DELETION_CODE.test(v) ? v : null;
}

export type DeletionStatus =
  | { state: 'none' }
  | { state: 'invalid' }
  | { state: 'unknown' }
  | { state: 'done'; at: string };

/** Turns the event rows found for a code into what the page shows. Never exposes who or what was deleted. */
export function deletionStatus(code: string | null, rows: Array<{ created_at: string }> | null): DeletionStatus {
  if (code === null) return { state: 'none' };
  if (!rows || rows.length === 0) return { state: 'unknown' };
  const latest = rows.map((r) => r.created_at).sort().at(-1) as string;
  return { state: 'done', at: latest };
}
