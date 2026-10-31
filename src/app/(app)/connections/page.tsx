import type { Metadata } from 'next';
import { ConnectionCard } from '@/components/connection-card';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { requireCreator } from '@/lib/auth';
import { CONNECTED_LABEL, connectError } from '@/lib/connect-messages';
import { loadIntegrations, platformsConfigured } from '@/lib/integrations/config';
import type { PublicConnection } from '@/lib/integrations/types';

export const metadata: Metadata = { title: 'Connections' };
export const dynamic = 'force-dynamic';

/** Columns the signed-in role may read. Token columns are not granted, so selecting them would fail by design. */
const SAFE_COLUMNS = 'id, platform, external_account_id, display_name, username, avatar_url, scopes, status, last_error, access_token_expires_at, meta, connected_at, last_refreshed_at, last_synced_at';

export default async function ConnectionsPage({ searchParams }: { searchParams: { error?: string; connected?: string; choose?: string } }) {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const { data, error } = await supabase.from('social_connections').select(SAFE_COLUMNS).eq('creator_id', profile.id);
  if (error) throw new Error(`connections: ${error.message}`);
  const rows = (data ?? []) as unknown as PublicConnection[];
  const youtube = rows.find((r) => r.platform === 'youtube') ?? null;
  const instagram = rows.find((r) => r.platform === 'instagram') ?? null;

  const setup = loadIntegrations();
  const apps = platformsConfigured();
  const err = connectError(searchParams.error);
  const connectedLabel = searchParams.connected ? CONNECTED_LABEL[searchParams.connected] : undefined;

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connect YouTube and Instagram to publish from PBOS and pull in real analytics. PBOS only posts what you approve, and it never invents numbers: anything it cannot read stays empty."
      />

      {err ? <Alert variant="destructive" title={err.title} className="mb-6">{err.hint}</Alert> : null}
      {connectedLabel ? (
        <Alert variant="success" title={connectedLabel} className="mb-6">
          {searchParams.connected === 'instagram' && searchParams.choose ? 'More than one Instagram account was found. Pick the one to use below. ' : ''}
          Use “Sync now” to pull your first numbers. They also refresh automatically.
        </Alert>
      ) : null}

      {!setup.ok ? (
        <Alert variant="warning" title="Connections need a few server settings first" className="mb-6">
          <p>{setup.reason} Add these in your hosting environment, then redeploy:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{setup.missing.map((name) => <li key={name}><code>{name}</code></li>)}</ul>
        </Alert>
      ) : null}

      <div className="space-y-5">
        <ConnectionCard platform="youtube" connection={youtube} configured={setup.ok && apps.youtube} />
        <ConnectionCard platform="instagram" connection={instagram} configured={setup.ok && apps.instagram} />
      </div>

      <Section title="Good to know" className="mt-10">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Your sign-in tokens are encrypted before they are stored and are never sent to your browser.</li>
          <li>YouTube numbers can lag by a couple of days. Instagram insights can lag up to 48 hours, and some need 100 or more followers. When a number is not available it is left out, not estimated.</li>
          <li>While a Google or Meta app is still in test mode, sign-ins expire sooner (Google: 7 days) and only approved test accounts can connect. PBOS will tell you here when a connection needs refreshing.</li>
          <li>Instagram has no scheduling feature of its own: PBOS publishes scheduled Instagram posts at the time you chose, as long as the app is running its scheduled jobs.</li>
          <li>You can disconnect at any time. You can also remove PBOS from your <a className="underline" href="https://myaccount.google.com/permissions" rel="noreferrer noopener" target="_blank">Google account</a> or your Facebook and Instagram settings.</li>
        </ul>
      </Section>
    </>
  );
}
