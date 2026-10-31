import 'server-only';
import { buildProof, toPublicProfile, type PublicProfile, type PublicProof } from '@/lib/public-kit';
import { createAdminClient } from '@/lib/supabase/admin';
import type { CreatorProfile, Post } from '@/lib/types';

export type PublicKit =
  | { state: 'ok'; profile: PublicProfile; proof: PublicProof }
  | { state: 'unpublished' }
  | { state: 'unavailable' };

/** The only columns ever selected for the public page. Goals, audience notes and user_id are not among them. */
const PUBLIC_COLUMNS = 'id, name, niche, positioning, voice, services, rate_card, faq, ai_persona, avatar_path, media_kit_published';

/**
 * Resolve the single published creator through the service-role client. `PUBLIC_CREATOR_ID` pins a
 * specific profile; otherwise the one published profile is used.
 */
export async function resolvePublicCreator(): Promise<{ id: string } | 'unpublished' | 'unavailable'> {
  const admin = createAdminClient();
  if (!admin) return 'unavailable';
  let query = admin.from('creator_profile').select('id').eq('media_kit_published', true).order('created_at', { ascending: true }).limit(1);
  const pinned = process.env.PUBLIC_CREATOR_ID;
  if (pinned) query = query.eq('id', pinned);
  const { data, error } = await query;
  if (error) {
    console.error('[public] resolve creator', error.message);
    return 'unavailable';
  }
  const row = (data ?? [])[0] as { id: string } | undefined;
  return row ?? 'unpublished';
}

export async function loadPublicKit(): Promise<PublicKit> {
  const admin = createAdminClient();
  if (!admin) return { state: 'unavailable' };

  const resolved = await resolvePublicCreator();
  if (resolved === 'unpublished' || resolved === 'unavailable') return { state: resolved };

  const [profileRes, postsRes] = await Promise.all([
    admin.from('creator_profile').select(PUBLIC_COLUMNS).eq('id', resolved.id).maybeSingle(),
    admin
      .from('posts')
      .select('platform, format, published_at, views, likes, comments, shares, saves, clicks, is_demo')
      .eq('creator_id', resolved.id)
      .eq('is_demo', false)
      .order('published_at', { ascending: false, nullsFirst: false })
      .limit(100),
  ]);
  if (profileRes.error || !profileRes.data) {
    if (profileRes.error) console.error('[public] load profile', profileRes.error.message);
    return { state: 'unavailable' };
  }
  if (postsRes.error) console.error('[public] load posts', postsRes.error.message);

  const row = profileRes.data as unknown as CreatorProfile;
  if (!row.media_kit_published) return { state: 'unpublished' };
  const profile = toPublicProfile(row, process.env.NEXT_PUBLIC_SUPABASE_URL);
  if (!profile) return { state: 'unpublished' };

  const posts = ((postsRes.error ? [] : postsRes.data) ?? []) as unknown as Post[];
  return { state: 'ok', profile, proof: buildProof(posts) };
}
