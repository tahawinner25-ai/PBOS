import { NextResponse, type NextRequest } from 'next/server';
import { getCreatorContext } from '@/lib/auth';
import { loadIntegrations } from '@/lib/integrations/config';
import { IntegrationError } from '@/lib/integrations/errors';
import { exchangeGoogleCode, missingScopes, revokeGoogleToken, YOUTUBE_SCOPES } from '@/lib/integrations/google';
import {
  exchangeForLongLived, exchangeMetaCode, getGrantedPermissions, getMetaUser, listInstagramCandidates, revokeMetaPermissions, META_SCOPES, type MetaCtx,
} from '@/lib/integrations/meta';
import { OAUTH_COOKIE, verifyOAuthState } from '@/lib/integrations/oauth-state';
import { AccountAlreadyLinkedError, saveConnection } from '@/lib/integrations/store';
import { getMyChannel } from '@/lib/integrations/youtube';
import { isPlatform } from '@/lib/integrations/types';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Permissions the publishing and analytics features cannot work without. */
const REQUIRED_META = ['instagram_basic', 'instagram_content_publish', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement'];

function finish(request: Request, query: string) {
  // Only fixed codes go in the URL, never provider text, so a crafted link cannot show arbitrary messages.
  const res = NextResponse.redirect(new URL(`/connections?${query}`, request.url));
  res.cookies.set(OAUTH_COOKIE, '', { path: '/api/connect', maxAge: 0 });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ platform: string }> }) {
  const { platform: platformParam } = await params;
  const ctx = await getCreatorContext();
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url));
  if (!isPlatform(platformParam)) return finish(request, 'error=unknown_platform');
  const platform = platformParam;
  if (!rateLimit(`connect-cb:${ctx.profile.id}`, 20, 60_000).allowed) return finish(request, 'error=rate_limited');

  const url = new URL(request.url);
  if (url.searchParams.get('error')) return finish(request, 'error=denied');

  const setup = loadIntegrations();
  if (!setup.ok) return finish(request, 'error=not_configured');
  const { env, ring, db } = setup;

  const verified = verifyOAuthState({
    cookieValue: request.cookies.get(OAUTH_COOKIE)?.value,
    stateParam: url.searchParams.get('state'),
    platform,
    creatorId: ctx.profile.id,
    secret: process.env.OAUTH_STATE_SECRET as string,
  });
  if (!verified.ok) {
    console.error(`[connect] ${platform} callback refused: ${verified.reason}`);
    return finish(request, 'error=state');
  }
  const code = url.searchParams.get('code');
  if (!code) return finish(request, 'error=denied');
  const creatorId = ctx.profile.id;

  try {
    if (platform === 'youtube') {
      if (!env.google) return finish(request, 'error=youtube_not_configured');
      const tokens = await exchangeGoogleCode(env.deps, env.google, code, verified.codeVerifier);
      if (missingScopes(tokens.scopes, YOUTUBE_SCOPES).length > 0) {
        await revokeGoogleToken(env.deps, tokens.refreshToken ?? tokens.accessToken).catch(() => undefined);
        return finish(request, 'error=scopes');
      }
      const channel = await getMyChannel(env.deps, tokens.accessToken);
      await saveConnection(db, ring, {
        creatorId, platform, externalAccountId: channel.id, displayName: channel.title, username: channel.customUrl, avatarUrl: channel.thumbnailUrl,
        scopes: tokens.scopes, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, accessTokenExpiresAt: tokens.expiresAt, meta: {},
      });
      await env.events.record(creatorId, 'youtube', 'connected', { channel: channel.id });
      return finish(request, 'connected=youtube');
    }

    if (!env.meta) return finish(request, 'error=instagram_not_configured');
    const ctxMeta: MetaCtx = { deps: env.deps, version: env.meta.version };
    const short = await exchangeMetaCode(ctxMeta, env.meta, code);
    const long = await exchangeForLongLived(ctxMeta, env.meta, short.accessToken);
    const perms = await getGrantedPermissions(ctxMeta, long.accessToken);
    if (REQUIRED_META.some((p) => !perms.granted.includes(p))) {
      await revokeMetaPermissions(ctxMeta, long.accessToken).catch(() => undefined);
      return finish(request, 'error=permissions');
    }
    const [user, candidates] = await Promise.all([getMetaUser(ctxMeta, long.accessToken), listInstagramCandidates(ctxMeta, long.accessToken)]);
    if (candidates.length === 0) {
      await revokeMetaPermissions(ctxMeta, long.accessToken).catch(() => undefined);
      return finish(request, 'error=no_instagram');
    }
    const chosen = candidates[0];
    await saveConnection(db, ring, {
      creatorId, platform, externalAccountId: chosen.instagram.id, displayName: chosen.instagram.name ?? chosen.pageName, username: chosen.instagram.username,
      avatarUrl: chosen.instagram.profilePictureUrl, scopes: perms.granted.filter((p) => (META_SCOPES as readonly string[]).includes(p)),
      accessToken: long.accessToken, pageToken: chosen.pageToken, accessTokenExpiresAt: long.expiresAt,
      meta: {
        fb_user_id: user.id, page_id: chosen.pageId, page_name: chosen.pageName, graph_version: env.meta.version,
        // Non-secret list so the creator can switch accounts later without signing in again.
        candidates: candidates.map((c) => ({ pageId: c.pageId, pageName: c.pageName, igId: c.instagram.id, igUsername: c.instagram.username })),
      },
    });
    await env.events.record(creatorId, 'instagram', 'connected', { account: chosen.instagram.id, candidates: candidates.length });
    return finish(request, candidates.length > 1 ? 'connected=instagram&choose=1' : 'connected=instagram');
  } catch (err) {
    if (err instanceof AccountAlreadyLinkedError) return finish(request, 'error=linked_elsewhere');
    if (err instanceof IntegrationError) {
      console.error(`[connect] ${platform} failed: ${err.kind} ${err.code ?? ''}`);
      if (err.code === 'no_refresh_token') return finish(request, 'error=no_refresh_token');
      if (err.code === 'no_channel') return finish(request, 'error=no_channel');
      return finish(request, 'error=provider');
    }
    console.error(`[connect] ${platform} unexpected error`, err instanceof Error ? err.name : typeof err);
    return finish(request, 'error=server');
  }
}
