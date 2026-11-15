import type { Metadata } from 'next';
import { ConnectionCard } from '@/components/connection-card';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { requireCreator } from '@/lib/auth';
import { CONNECTED_LABEL, connectError } from '@/lib/connect-messages';
import { loadIntegrations, platformsConfigured } from '@/lib/integrations/config';
import { buildSystemStatus } from '@/lib/system-status';
import { aiConfig } from '@/lib/server/ai';
import { createAdminClient } from '@/lib/supabase/admin';
import type { PublicConnection } from '@/lib/integrations/types';

export const metadata: Metadata = { title: 'Connections' };
export const dynamic = 'force-dynamic';

/** Columns the signed-in role may read. Token columns are not granted, so selecting them would fail by design. */
const SAFE_COLUMNS = 'id, platform, external_account_id, display_name, username, avatar_url, scopes, status, last_error, access_token_expires_at, meta, connected_at, last_refreshed_at, last_synced_at';

export default async function ConnectionsPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ error?: string; connected?: string; choose?: string }> }) {
  const searchParams = await searchParamsPromise;
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const { data, error } = await supabase.from('social_connections').select(SAFE_COLUMNS).eq('creator_id', profile.id);
  if (error) throw new Error(`connections: ${error.message}`);
  const rows = (data ?? []) as unknown as PublicConnection[];
  const youtube = rows.find((r) => r.platform === 'youtube') ?? null;
  const gmail = rows.find((r) => r.platform === 'gmail') ?? null;

  const status = buildSystemStatus({
    aiKey: Boolean(aiConfig() || process.env.ANTHROPIC_API_KEY),
    aiProvider: aiConfig() ? 'gemini-compatible' : process.env.ANTHROPIC_API_KEY ? 'anthropic' : null,
    openaiImageKey: Boolean(process.env.OPENAI_API_KEY),
    storageReady: Boolean(createAdminClient()),
    cronSecret: Boolean(process.env.CRON_SECRET),
    siteUrl: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
  });

  const setup = loadIntegrations();
  const apps = platformsConfigured();
  const err = connectError(searchParams.error);
  const connectedLabel = searchParams.connected ? CONNECTED_LABEL[searchParams.connected] : undefined;

  return (
    <>
      <PageHeader
        title="Connections"
        description="Connect YouTube to publish from PBOS and pull in real analytics, and Gmail to send the emails you approve and let the agent search your inbox. PBOS only posts and sends what you approve, and it never invents numbers: anything it cannot read stays empty."
      />

      {err ? <Alert variant="destructive" title={err.title} className="mb-6">{err.hint}</Alert> : null}
      {connectedLabel ? (
        <Alert variant="success" title={connectedLabel} className="mb-6">
          {searchParams.connected === 'gmail' ? 'Ask the agent to draft an email: it appears as an approval card with the exact text, and goes out only when you press Approve.' : 'Use “Sync now” to pull your first numbers. They also refresh automatically.'}
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
        <ConnectionCard platform="gmail" connection={gmail} configured={setup.ok && apps.gmail} />
      </div>

      <Section title="What is switched on" description="Plain status of this deployment. If something you expect to work is off, the next step is written here." className="mt-10">
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {status.map((row) => (
            <li key={row.key} className="flex gap-3 p-3 text-sm">
              <span aria-hidden="true" className={row.ok ? 'text-success' : 'text-warning'}>{row.ok ? '✓' : '!'}</span>
              <div className="min-w-0">
                <p className="font-medium">{row.label}<span className="sr-only">{row.ok ? ' (on)' : ' (off)'}</span></p>
                <p className="text-muted-foreground">{row.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Good to know" className="mt-10">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li>Your sign-in tokens are encrypted before they are stored and are never sent to your browser.</li>
          <li>YouTube numbers can lag by a couple of days. When a number is not available it is left out, not estimated.</li>
          <li>While the Google app is still in test mode, sign-ins expire sooner (7 days) and only approved test accounts can connect. PBOS will tell you here when a connection needs refreshing.</li>
          <li>Gmail: PBOS can send what you approve and search your inbox when you ask the agent to. A search returns only sender, subject, date and a short preview of a few emails; nothing is stored, nothing is changed or deleted, and each email PBOS sends needs your Approve on the exact text and recipient. Google treats these permissions as sensitive, so until the Google app is verified only the app owner and listed test users can connect Gmail. If you connected Gmail before this update, reconnect it once to allow search.</li>
          <li>You can disconnect at any time. You can also remove PBOS from your <a className="underline" href="https://myaccount.google.com/permissions" rel="noreferrer noopener" target="_blank">Google account</a> .</li>
        </ul>
      </Section>
    </>
  );
}
