import { IntegrationError } from './errors';
import { formBody, request, requestJson } from './http';
import type { Deps } from './types';

/**
 * Google OAuth 2.0 (authorization-code flow with PKCE, offline access).
 *
 * Why the choices below:
 *  - access_type=offline + prompt=consent: Google only returns a refresh token on a consent that asks
 *    for it. Without a refresh token scheduled work cannot run after the first hour.
 *  - include_granted_scopes=true: incremental authorization.
 *  - PKCE (S256) on top of the client secret: a stolen authorization code is useless without the verifier.
 *  - Least privilege: upload videos, read channel data, read analytics. Nothing that edits or deletes.
 *
 * Refresh-token lifetime (Google, "Testing" vs "In production"): while the OAuth consent screen is in
 * Testing, refresh tokens expire after 7 days. In production they last until revoked or unused for
 * about six months. The connection health UI explains this and asks the creator to reconnect on
 * `invalid_grant` (see connections.ts).
 */

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export const GOOGLE_SCOPES = {
  upload: 'https://www.googleapis.com/auth/youtube.upload',
  readonly: 'https://www.googleapis.com/auth/youtube.readonly',
  analytics: 'https://www.googleapis.com/auth/yt-analytics.readonly',
} as const;

export const YOUTUBE_SCOPES: string[] = [GOOGLE_SCOPES.upload, GOOGLE_SCOPES.readonly, GOOGLE_SCOPES.analytics];

export type GoogleClient = { clientId: string; clientSecret: string; redirectUri: string };

export type GoogleTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
};

type TokenResponse = { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };

export function buildGoogleAuthUrl(args: { client: GoogleClient; scopes: string[]; state: string; codeChallenge: string; loginHint?: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = formBody({
    client_id: args.client.clientId,
    redirect_uri: args.client.redirectUri,
    response_type: 'code',
    scope: args.scopes.join(' '),
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: 'S256',
    login_hint: args.loginHint,
  }).toString();
  return url.toString();
}

function toTokens(body: TokenResponse, deps: Deps): GoogleTokens {
  if (!body.access_token || typeof body.expires_in !== 'number') {
    throw new IntegrationError({ kind: 'unknown', platform: 'oauth-google', detail: 'token response was missing fields' });
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? null,
    expiresAt: new Date(deps.now().getTime() + body.expires_in * 1000),
    scopes: (body.scope ?? '').split(/\s+/).filter(Boolean),
  };
}

export async function exchangeGoogleCode(deps: Deps, client: GoogleClient, code: string, codeVerifier: string): Promise<GoogleTokens> {
  const body = await requestJson<TokenResponse>(
    deps,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        redirect_uri: client.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    },
    { platform: 'oauth-google', maxAttempts: 2 },
  );
  const tokens = toTokens(body, deps);
  if (!tokens.refreshToken) {
    throw new IntegrationError({
      kind: 'invalid',
      platform: 'oauth-google',
      code: 'no_refresh_token',
      userMessage: 'Google did not issue a refresh token. Remove PBOS under your Google Account → Security → Third-party access, then connect again.',
    });
  }
  return tokens;
}

/** Trades the refresh token for a new access token. Throws kind=auth on `invalid_grant` (revoked or expired). */
export async function refreshGoogleAccessToken(deps: Deps, client: GoogleClient, refreshToken: string): Promise<GoogleTokens> {
  const body = await requestJson<TokenResponse>(
    deps,
    GOOGLE_TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ client_id: client.clientId, client_secret: client.clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
    },
    { platform: 'oauth-google', maxAttempts: 3 },
  );
  return toTokens(body, deps);
}

/** Best-effort revoke on disconnect. A token that is already invalid counts as revoked. */
export async function revokeGoogleToken(deps: Deps, token: string): Promise<void> {
  try {
    await request(
      deps,
      GOOGLE_REVOKE_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formBody({ token }) },
      { platform: 'oauth-google', maxAttempts: 2 },
    );
  } catch (err) {
    if (err instanceof IntegrationError && (err.kind === 'auth' || err.code === 'invalid_token' || err.kind === 'invalid')) return;
    throw err;
  }
}

export const missingScopes = (granted: string[], required: string[]): string[] => required.filter((scope) => !granted.includes(scope));
