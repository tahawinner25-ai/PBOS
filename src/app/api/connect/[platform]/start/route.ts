import { NextResponse } from 'next/server';
import { getCreatorContext } from '@/lib/auth';
import { buildGoogleAuthUrl, YOUTUBE_SCOPES } from '@/lib/integrations/google';
import { buildMetaAuthUrl } from '@/lib/integrations/meta';
import { createOAuthState, OAUTH_COOKIE } from '@/lib/integrations/oauth-state';
import { loadIntegrations } from '@/lib/integrations/config';
import { isPlatform } from '@/lib/integrations/types';
import { rateLimit } from '@/lib/server/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const back = (request: Request, error: string) => NextResponse.redirect(new URL(`/connections?error=${error}`, request.url));

/**
 * Starts "Connect YouTube" / "Connect Instagram". Only a signed-in creator can start it. We create a
 * signed, httpOnly state cookie bound to this creator and platform (plus a PKCE verifier) and send the
 * browser to Google or Meta. The callback refuses anything that does not match that cookie.
 */
export async function GET(request: Request, { params }: { params: { platform: string } }) {
  const ctx = await getCreatorContext();
  if (!ctx) return NextResponse.redirect(new URL('/login', request.url));
  if (!isPlatform(params.platform)) return back(request, 'unknown_platform');
  const platform = params.platform;

  if (!rateLimit(`connect:${ctx.profile.id}`, 10, 60_000).allowed) return back(request, 'rate_limited');

  const setup = loadIntegrations();
  if (!setup.ok) return back(request, 'not_configured');
  const { env } = setup;
  const secret = process.env.OAUTH_STATE_SECRET as string;
  const created = createOAuthState({ creatorId: ctx.profile.id, platform, secret });

  let target: string;
  if (platform === 'youtube') {
    if (!env.google) return back(request, 'youtube_not_configured');
    target = buildGoogleAuthUrl({ client: env.google, scopes: YOUTUBE_SCOPES, state: created.state, codeChallenge: created.codeChallenge });
  } else {
    if (!env.meta) return back(request, 'instagram_not_configured');
    target = buildMetaAuthUrl({ app: env.meta, state: created.state });
  }

  const res = NextResponse.redirect(target);
  res.cookies.set(OAUTH_COOKIE, created.cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax', // the provider redirects back with a top-level GET, which Lax allows
    path: '/api/connect',
    maxAge: created.maxAgeSec,
  });
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
