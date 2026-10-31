import 'server-only';
import { siteUrl } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import { parseKeyring, TokenCryptoError, type Keyring } from './crypto';
import { DEFAULT_GRAPH_VERSION } from './meta';
import type { Env } from './ports';
import { quotaConfigFromEnv } from './quota';
import {
  SupabaseAnalyticsStore, SupabaseConnectionStore, SupabaseEventSink, SupabaseJobStore, SupabaseMediaStore, SupabasePostStore, SupabaseQuotaStore,
} from './store';
import { realDeps, type Platform } from './types';

/**
 * Builds the integration environment from process.env. Nothing here ever returns or logs a secret:
 * when something is missing the result lists the environment variable NAMES that need to be set.
 */

export type IntegrationSetup =
  | { ok: true; env: Env; ring: Keyring; db: NonNullable<ReturnType<typeof createAdminClient>> }
  | { ok: false; missing: string[]; reason: string };

const callbackUrl = (platform: Platform) => `${siteUrl()}/api/connect/${platform}/callback`;

/** Which platforms have their app credentials configured (names only, for the Connections page). */
export function platformsConfigured(): Record<Platform, boolean> {
  return {
    youtube: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    instagram: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET),
  };
}

export function loadIntegrations(): IntegrationSetup {
  const missing: string[] = [];
  const db = createAdminClient();
  if (!db) missing.push('NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');

  let ring: Keyring | null = null;
  try {
    ring = parseKeyring({ keys: process.env.TOKEN_ENCRYPTION_KEYS, single: process.env.TOKEN_ENCRYPTION_KEY });
  } catch (err) {
    if (err instanceof TokenCryptoError) return { ok: false, missing: ['TOKEN_ENCRYPTION_KEYS'], reason: 'TOKEN_ENCRYPTION_KEYS is set but is not valid. Each key must be 32 random bytes in base64 (run: node scripts/gen-keys.mjs).' };
    throw err;
  }
  if (!ring) missing.push('TOKEN_ENCRYPTION_KEYS');
  const secret = process.env.OAUTH_STATE_SECRET ?? '';
  if (secret.length < 32) missing.push('OAUTH_STATE_SECRET');
  if (!db || !ring || missing.length) return { ok: false, missing, reason: 'Integrations need these server settings before anything can be connected.' };

  const google = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, redirectUri: callbackUrl('youtube') }
    : null;
  const meta = process.env.META_APP_ID && process.env.META_APP_SECRET
    ? { appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET, redirectUri: callbackUrl('instagram'), version: process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION, loginConfigId: process.env.META_LOGIN_CONFIG_ID || undefined }
    : null;

  const env: Env = {
    deps: realDeps(),
    conns: new SupabaseConnectionStore(db, ring),
    jobs: new SupabaseJobStore(db),
    media: new SupabaseMediaStore(db),
    posts: new SupabasePostStore(db),
    analytics: new SupabaseAnalyticsStore(db),
    quota: new SupabaseQuotaStore(db),
    events: new SupabaseEventSink(db),
    google,
    meta,
    quotaConfig: quotaConfigFromEnv(process.env),
  };
  return { ok: true, env, ring, db };
}
