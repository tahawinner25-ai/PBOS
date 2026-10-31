import { IntegrationError } from './errors';
import { refreshGoogleAccessToken, type GoogleClient } from './google';
import { exchangeForLongLived, type MetaApp, type MetaCtx, type MetaUsage } from './meta';
import type { ConnectionStore, EventSink } from './ports';
import type { ConnectionSecrets, Deps } from './types';

/**
 * Keeps credentials usable. Callers ask for a token or Page credentials and either get something
 * that works now or a precise reason it cannot (`NotConnectedError`, `ReauthRequiredError`).
 *
 * Google: the access token lives about an hour, so it is refreshed from the stored refresh token when
 * it is within two minutes of expiry. `invalid_grant` means the grant is gone (revoked, expired in
 * Testing mode, unused for six months): the connection is marked needs_reauth and the creator is asked
 * to reconnect. Nothing retries a dead refresh token.
 *
 * Meta: the long-lived user token lasts about 60 days. It is renewed when fewer than 14 days remain.
 * The Page token used for API calls is stored separately and does not expire while the grant is valid.
 */

export class NotConnectedError extends Error {
  constructor(readonly platform: string) {
    super(`${platform} is not connected`);
    this.name = 'NotConnectedError';
  }
}

export class ReauthRequiredError extends Error {
  constructor(readonly platform: string, readonly reason: string) {
    super(`${platform} needs to be reconnected: ${reason}`);
    this.name = 'ReauthRequiredError';
  }
}

const GOOGLE_SKEW_MS = 120_000;
const META_RENEW_WITHIN_MS = 14 * 86_400_000;

type Common = { deps: Deps; conns: ConnectionStore; events: EventSink; creatorId: string };

async function markNeedsReauth(c: Common, platform: 'youtube' | 'instagram', reason: string): Promise<never> {
  await c.conns.update(c.creatorId, platform, { status: 'needs_reauth', lastError: reason.slice(0, 480) });
  await c.events.record(c.creatorId, platform, 'token_refresh_failed', { reason: reason.slice(0, 200) });
  throw new ReauthRequiredError(platform, reason);
}

export async function getYouTubeToken(args: Common & { google: GoogleClient }): Promise<{ token: string; conn: ConnectionSecrets }> {
  const conn = await args.conns.get(args.creatorId, 'youtube');
  if (!conn) throw new NotConnectedError('YouTube');
  if (conn.status !== 'active') throw new ReauthRequiredError('YouTube', conn.status);
  const now = args.deps.now().getTime();
  if (conn.accessToken && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() - now > GOOGLE_SKEW_MS) return { token: conn.accessToken, conn };
  if (!conn.refreshToken) return markNeedsReauth(args, 'youtube', 'no refresh token is stored');

  try {
    const tokens = await refreshGoogleAccessToken(args.deps, args.google, conn.refreshToken);
    await args.conns.update(args.creatorId, 'youtube', {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.expiresAt,
      // Google normally keeps the same refresh token; store a new one only if it rotated.
      ...(tokens.refreshToken && tokens.refreshToken !== conn.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
      lastRefreshedAt: args.deps.now(),
      lastError: null,
    });
    return { token: tokens.accessToken, conn: { ...conn, accessToken: tokens.accessToken, accessTokenExpiresAt: tokens.expiresAt } };
  } catch (err) {
    if (err instanceof IntegrationError && err.kind === 'auth') {
      return markNeedsReauth(args, 'youtube', 'Google no longer accepts the saved sign-in. If your Google consent screen is in Testing mode, tokens expire after 7 days.');
    }
    throw err;
  }
}

export type InstagramCreds = { pageToken: string; igUserId: string; conn: ConnectionSecrets; ctx: MetaCtx };

export async function getInstagramCreds(args: Common & { meta: MetaApp; onUsage?: (usage: MetaUsage) => void }): Promise<InstagramCreds> {
  const conn = await args.conns.get(args.creatorId, 'instagram');
  if (!conn) throw new NotConnectedError('Instagram');
  if (conn.status !== 'active') throw new ReauthRequiredError('Instagram', conn.status);
  const ctx: MetaCtx = { deps: args.deps, version: args.meta.version, onUsage: args.onUsage };
  const now = args.deps.now().getTime();
  let current = conn;

  const expiresAt = conn.accessTokenExpiresAt?.getTime() ?? null;
  if (conn.accessToken && expiresAt !== null && expiresAt - now < META_RENEW_WITHIN_MS) {
    try {
      const renewed = await exchangeForLongLived(ctx, args.meta, conn.accessToken);
      await args.conns.update(args.creatorId, 'instagram', { accessToken: renewed.accessToken, accessTokenExpiresAt: renewed.expiresAt, lastRefreshedAt: args.deps.now(), lastError: null });
      current = { ...conn, accessToken: renewed.accessToken, accessTokenExpiresAt: renewed.expiresAt };
    } catch (err) {
      if (!(err instanceof IntegrationError)) throw err;
      // The Page token may still work until the user token actually lapses. Only a lapsed token is fatal.
      if (err.kind === 'auth' && expiresAt <= now) return markNeedsReauth(args, 'instagram', 'The 60-day Facebook sign-in has expired.');
      await args.events.record(args.creatorId, 'instagram', 'token_refresh_failed', { kind: err.kind, retry: err.retryable });
    }
  }
  if (!current.pageToken) return markNeedsReauth(args, 'instagram', 'no Page token is stored');
  return { pageToken: current.pageToken, igUserId: current.external_account_id, conn: current, ctx };
}

/** For the refresh job: renew one connection ahead of time. Returns what happened, never throws for expected states. */
export async function refreshConnection(args: Common & { platform: 'youtube' | 'instagram'; google: GoogleClient | null; meta: MetaApp | null }): Promise<'refreshed' | 'needs_reauth' | 'skipped' | 'error'> {
  try {
    if (args.platform === 'youtube') {
      if (!args.google) return 'skipped';
      const conn = await args.conns.get(args.creatorId, 'youtube');
      if (!conn || conn.status !== 'active') return 'skipped';
      // Force a refresh when the token is within 15 minutes of expiry; otherwise nothing to do.
      const left = (conn.accessTokenExpiresAt?.getTime() ?? 0) - args.deps.now().getTime();
      if (left > 15 * 60_000) return 'skipped';
      await getYouTubeToken({ ...args, google: args.google });
      return 'refreshed';
    }
    if (!args.meta) return 'skipped';
    await getInstagramCreds({ ...args, meta: args.meta });
    return 'refreshed';
  } catch (err) {
    if (err instanceof ReauthRequiredError) return 'needs_reauth';
    if (err instanceof NotConnectedError) return 'skipped';
    return 'error';
  }
}
