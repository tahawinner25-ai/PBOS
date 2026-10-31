'use server';

import { revalidatePath } from 'next/cache';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { syncCreator, type SyncSummary } from '@/lib/integrations/analytics-sync';
import { loadIntegrations } from '@/lib/integrations/config';
import { revokeGoogleToken } from '@/lib/integrations/google';
import { listInstagramCandidates, revokeMetaPermissions, type MetaCtx } from '@/lib/integrations/meta';
import { deleteInstagramData, deleteYouTubeData } from '@/lib/integrations/store';
import { isPlatform } from '@/lib/integrations/types';
import { rateLimit } from '@/lib/server/rate-limit';
import type { ActionResult } from '@/lib/types';

const touch = () => ['/connections', '/publish', '/analytics', '/dashboard'].forEach((p) => revalidatePath(p));
const NOT_READY = 'Connections are not set up on this deployment yet. See the setup notes on the Connections page.';

/**
 * Disconnects a platform: revokes our access at Google/Meta (best effort), deletes the stored tokens, and
 * cancels posts that were waiting to go out through that connection. With `alsoDeleteData` it removes
 * everything PBOS synced from that platform too (analytics numbers, synced posts, publish history).
 */
export async function disconnectPlatform(platform: string, alsoDeleteData = false): Promise<ActionResult> {
  return withCreator(async ({ profile }) => {
    if (!isPlatform(platform)) return fail('Unknown platform.');
    const setup = loadIntegrations();
    if (!setup.ok) return fail(NOT_READY);
    const { env, db } = setup;
    const creatorId = profile.id;

    const conn = await env.conns.get(creatorId, platform);
    if (conn) {
      try {
        if (platform === 'youtube' && env.google) await revokeGoogleToken(env.deps, conn.refreshToken ?? conn.accessToken ?? '');
        if (platform === 'instagram' && env.meta && conn.accessToken) await revokeMetaPermissions({ deps: env.deps, version: env.meta.version } satisfies MetaCtx, conn.accessToken);
      } catch {
        // The platform may already have dropped the grant. The local credentials are removed either way.
        console.error(`[connections] revoke at ${platform} failed; removing local credentials anyway`);
      }
    }
    // Posts that were waiting to go out can no longer be sent. Cancel them so nothing surprises the creator after a reconnect.
    const cancel = await db.from('publish_jobs').update({ status: 'cancelled', last_error: 'Cancelled because the account was disconnected.', locked_until: null })
      .eq('creator_id', creatorId).eq('platform', platform).in('status', ['scheduled', 'processing']);
    if (cancel.error) return dbFail('disconnect.cancel', cancel.error);

    try {
      if (alsoDeleteData) await (platform === 'youtube' ? deleteYouTubeData(db, creatorId) : deleteInstagramData(db, creatorId));
      else await db.from('social_connections').delete().eq('creator_id', creatorId).eq('platform', platform);
    } catch (err) {
      console.error('[connections] delete failed', err instanceof Error ? err.message : 'unknown');
      return fail('Could not remove the connection. Nothing else was changed. Try again.');
    }
    await env.events.record(creatorId, platform, alsoDeleteData ? 'disconnected_and_deleted' : 'disconnected', {});
    touch();
    return ok(alsoDeleteData ? 'Disconnected, and the data synced from it was deleted.' : 'Disconnected. Your saved ideas and posts are untouched.');
  });
}

/** Pulls fresh numbers now. Limited to one run per platform every 30 seconds. */
export async function syncNow(platform: string): Promise<ActionResult<SyncSummary>> {
  return withCreator<SyncSummary>(async ({ profile }) => {
    if (!isPlatform(platform)) return fail('Unknown platform.');
    if (!rateLimit(`sync:${profile.id}:${platform}`, 1, 30_000).allowed) return fail('A sync just ran. Wait half a minute and try again.');
    const setup = loadIntegrations();
    if (!setup.ok) return fail(NOT_READY);
    const [summary] = await syncCreator(setup.env, profile.id, [platform]);
    touch();
    if (!summary.ok) return fail(summary.error ?? 'The sync did not complete.');
    const parts = [`${summary.points} data points`, `${summary.posts} posts`].join(' and ');
    return { ok: true, message: `Synced ${parts}.${summary.notes.length ? ` ${summary.notes[0]}` : ''}`, data: summary };
  });
}

/** Switch which Instagram account (of those the creator granted) PBOS uses, without signing in again. */
export async function selectInstagramAccount(igId: string): Promise<ActionResult> {
  return withCreator(async ({ profile }) => {
    if (typeof igId !== 'string' || !/^\d{5,25}$/.test(igId)) return fail('Choose one of the listed accounts.');
    const setup = loadIntegrations();
    if (!setup.ok || !setup.env.meta) return fail(NOT_READY);
    const { env, db } = setup;
    const meta = setup.env.meta;
    const conn = await env.conns.get(profile.id, 'instagram');
    if (!conn?.accessToken) return fail('Instagram is not connected.');
    const found = (await listInstagramCandidates({ deps: env.deps, version: meta.version }, conn.accessToken)).find((c) => c.instagram.id === igId);
    if (!found) return fail('That account is no longer available to PBOS. Reconnect Instagram to refresh the list.');
    const res = await db.from('social_connections').update({
      external_account_id: found.instagram.id, display_name: found.instagram.name ?? found.pageName, username: found.instagram.username, avatar_url: found.instagram.profilePictureUrl,
      meta: { ...conn.meta, page_id: found.pageId, page_name: found.pageName },
    }).eq('creator_id', profile.id).eq('platform', 'instagram');
    if (res.error) return res.error.code === '23505' ? fail('That Instagram account is already connected to another PBOS user.') : dbFail('selectInstagramAccount', res.error);
    await env.conns.update(profile.id, 'instagram', { pageToken: found.pageToken, status: 'active', lastError: null });
    touch();
    return ok(`Now using @${found.instagram.username ?? found.instagram.id}.`);
  });
}
