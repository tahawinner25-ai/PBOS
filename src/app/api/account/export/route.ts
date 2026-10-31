import { getCreatorContext } from '@/lib/auth';
import { assembleExport, EXPORT_ROW_CAP, EXPORT_TABLES, exportFilename, type TableResult } from '@/lib/account';
import { json } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Downloads everything the signed-in creator owns as one JSON file (data portability).
 * It reads through the creator's own row-level-security session, so it can only ever return their rows,
 * and token columns are not selectable by that role in any case.
 */
export async function GET() {
  const ctx = await getCreatorContext();
  if (!ctx) return json({ error: 'unauthorized' }, 401);
  if (!rateLimit(`account-export:${ctx.user.id}`, 5, 60 * 60_000).allowed) return json({ error: 'rate_limited' }, 429);

  const results: Record<string, TableResult> = {};
  await Promise.all(
    EXPORT_TABLES.map(async (t) => {
      const { data, error } = await ctx.supabase
        .from(t.table)
        .select(t.columns)
        .eq('creator_id', ctx.profile.id)
        .order(t.orderBy, { ascending: true })
        .limit(EXPORT_ROW_CAP);
      if (error) {
        console.error(`[export] ${t.table}:`, error.code, error.message);
        results[t.key] = { error: 'This part could not be read. Try again in a moment.' };
      } else {
        results[t.key] = { rows: (data ?? []) as unknown[] };
      }
    }),
  );

  const now = new Date();
  const body = JSON.stringify(assembleExport(now, ctx.profile, results), null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${exportFilename(now)}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
