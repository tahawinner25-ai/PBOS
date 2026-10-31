'use server';

import { dbFail, fail, withCreator } from '@/lib/action-helpers';
import { rateLimit } from '@/lib/server/rate-limit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A short-lived link (10 minutes) to one of the creator's own library videos, so the Studio can load it into the
 * editor. The creator's ownership is checked through their own session first (row-level security plus an
 * explicit creator filter), and only then is the private bucket opened with the service key.
 */
export async function signedVideoUrl(mediaId: string): Promise<ActionResult<{ url: string; label: string | null; bytes: number | null }>> {
  return withCreator<{ url: string; label: string | null; bytes: number | null }>(async ({ supabase, profile }) => {
    if (typeof mediaId !== 'string' || !UUID.test(mediaId)) return fail('That video was not found.');
    if (!rateLimit(`studio-url:${profile.id}`, 60, 60_000).allowed) return fail('Too many requests in a minute. Wait a moment.');
    const found = await supabase.from('media_assets').select('bucket, storage_path, label, bytes, kind').eq('id', mediaId).eq('creator_id', profile.id).maybeSingle();
    if (found.error) return dbFail('signedVideoUrl', found.error);
    const row = found.data as { bucket: string; storage_path: string; label: string | null; bytes: number | null; kind: string } | null;
    if (!row || row.kind !== 'video') return fail('That video was not found.');
    const admin = createAdminClient();
    if (!admin) return fail('File storage is not set up on this deployment yet (SUPABASE_SERVICE_ROLE_KEY is missing).');
    const signed = await admin.storage.from(row.bucket).createSignedUrl(row.storage_path, 600);
    if (signed.error || !signed.data?.signedUrl) return fail('Could not open that video. Try again.');
    return { ok: true, data: { url: signed.data.signedUrl, label: row.label, bytes: row.bytes } };
  });
}
