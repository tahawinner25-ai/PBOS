import { CheckCircle2, CircleAlert, Link2, PlugZap } from 'lucide-react';
import { disconnectPlatform, selectInstagramAccount, syncNow } from '@/actions/connections';
import { ActionButton } from '@/components/action-button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { formatDate } from '@/lib/format';
import type { PublicConnection } from '@/lib/integrations/types';
import { cn } from '@/lib/utils';

const COPY = {
  youtube: {
    name: 'YouTube',
    does: 'Upload videos and Shorts, schedule them, and read channel and video analytics.',
    needs: 'You will be asked for three permissions: upload videos, view your channel, and view analytics. PBOS cannot edit or delete anything else.',
  },
  instagram: {
    name: 'Instagram',
    does: 'Publish Reels, photos and carousels, and read reach, engagement and follower numbers.',
    needs: 'Requires a Business or Creator account linked to a Facebook Page you manage. You will sign in through Facebook.',
  },
} as const;

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return formatDate(iso);
}

type Candidate = { igId: string; igUsername: string | null; pageName: string };

/** One platform. Never receives a token: PublicConnection has none. */
export function ConnectionCard({ platform, connection, configured }: { platform: 'youtube' | 'instagram'; connection: PublicConnection | null; configured: boolean }) {
  const copy = COPY[platform];
  const candidates = ((connection?.meta?.candidates as Candidate[] | undefined) ?? []).filter((c) => c && typeof c.igId === 'string');
  const needsReauth = connection?.status === 'needs_reauth';
  const expires = connection?.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : null;
  const daysLeft = platform === 'instagram' && expires ? Math.floor((expires - Date.now()) / 86_400_000) : null;

  return (
    <Card className="p-5" aria-labelledby={`${platform}-title`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 id={`${platform}-title`} className="flex items-center gap-2 text-lg">
            <PlugZap aria-hidden="true" className="size-4 text-muted-foreground" />
            {copy.name}
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">{copy.does}</p>
        </div>
        {!connection ? <Badge variant="outline">Not connected</Badge> : needsReauth ? <Badge variant="warning"><CircleAlert aria-hidden="true" className="size-3" /> Needs reconnecting</Badge> : <Badge variant="success"><CheckCircle2 aria-hidden="true" className="size-3" /> Connected</Badge>}
      </div>

      {connection ? (
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Account</dt><dd className="truncate font-medium">{connection.display_name ?? connection.external_account_id}{connection.username ? <span className="font-normal text-muted-foreground"> · {connection.username}</span> : null}</dd></div>
          <div><dt className="text-muted-foreground">Connected</dt><dd>{formatDate(connection.connected_at)}</dd></div>
          <div><dt className="text-muted-foreground">Last data sync</dt><dd>{relative(connection.last_synced_at)}</dd></div>
          <div><dt className="text-muted-foreground">Token health</dt><dd>
            {needsReauth ? 'Expired or revoked' : platform === 'youtube' ? 'Renews automatically' : daysLeft !== null ? `Renews automatically (${Math.max(daysLeft, 0)} days left on the current token)` : 'Renews automatically'}
          </dd></div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{copy.needs}</p>
      )}

      {needsReauth && connection?.last_error ? <p role="alert" className="mt-3 rounded-md bg-warning/10 p-3 text-sm">{connection.last_error}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {configured ? (
          <a href={`/api/connect/${platform}/start`} className={cn(buttonVariants({ variant: connection && !needsReauth ? 'outline' : 'default', size: 'sm' }))}>
            <Link2 aria-hidden="true" /> {connection ? (needsReauth ? 'Reconnect' : 'Reconnect or change account') : `Connect ${copy.name}`}
          </a>
        ) : (
          <Badge variant="outline">Not set up on this deployment</Badge>
        )}
        {connection && !needsReauth ? (
          <ActionButton variant="secondary" size="sm" action={syncNow.bind(null, platform)} pendingLabel="Syncing…">Sync now</ActionButton>
        ) : null}
        {connection ? (
          <>
            <ActionButton variant="ghost" size="sm" action={disconnectPlatform.bind(null, platform, false)} confirm={`Disconnect ${copy.name}? Posts waiting to go out through it will be cancelled. Your ideas and saved numbers stay.`}>Disconnect</ActionButton>
            <ActionButton variant="ghost" size="sm" className="text-destructive" action={disconnectPlatform.bind(null, platform, true)} confirm={`Disconnect ${copy.name} AND delete everything PBOS synced from it (analytics numbers, synced posts, publish history)? This cannot be undone.`}>Disconnect and delete data</ActionButton>
          </>
        ) : null}
      </div>

      {platform === 'instagram' && connection && candidates.length > 1 ? (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-sm font-medium">More than one account was found. Use:</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <ActionButton key={c.igId} size="sm" variant={c.igId === connection.external_account_id ? 'default' : 'outline'} disabled={c.igId === connection.external_account_id} action={selectInstagramAccount.bind(null, c.igId)}>
                {c.igUsername ? `@${c.igUsername}` : c.igId} <span className="font-normal opacity-70">({c.pageName})</span>
              </ActionButton>
            ))}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
