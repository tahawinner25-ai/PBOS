import Link from 'next/link';
import { syncNow } from '@/actions/connections';
import { ActionButton } from '@/components/action-button';
import { EmptyState } from '@/components/empty-state';
import { StatStrip } from '@/components/stat-strip';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { timeAgo } from '@/lib/format';
import type { DayValue, PlatformView } from '@/lib/platform-stats';
import { cn } from '@/lib/utils';

const NAME = { youtube: 'YouTube', instagram: 'Instagram' } as const;

/** Bars drawn from real daily values only. The data table below the chart is the accessible version of the same numbers. */
function Bars({ label, days }: { label: string; days: DayValue[] }) {
  const max = Math.max(...days.map((d) => d.value), 1);
  const w = 560;
  const h = 96;
  const gap = 2;
  const bw = Math.max(2, (w - gap * (days.length - 1)) / days.length);
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <div className="mt-5">
      <p className="mb-1 text-xs text-muted-foreground">{label} · {first.day} to {last.day}</p>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}, ${days.length} days from ${first.day} to ${last.day}. Highest day ${max.toLocaleString('en-US')}.`} className="h-24 w-full text-primary" preserveAspectRatio="none">
        {days.map((d, i) => {
          const bh = Math.max(1, (d.value / max) * (h - 4));
          return <rect key={d.day} x={i * (bw + gap)} y={h - bh} width={bw} height={bh} rx={1} fill="currentColor" opacity={0.85} />;
        })}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show the numbers</summary>
        <table className="mt-2 w-full max-w-sm text-left text-xs">
          <caption className="sr-only">{label}</caption>
          <thead><tr><th scope="col" className="py-1 font-medium">Day</th><th scope="col" className="py-1 text-right font-medium">Value</th></tr></thead>
          <tbody>{days.slice().reverse().map((d) => <tr key={d.day} className="border-t border-border"><td className="py-1">{d.day}</td><td className="tabular py-1 text-right">{d.value.toLocaleString('en-US')}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}

export type PlatformStatsProps = {
  views: Array<{ view: PlatformView; connected: boolean; status: string | null }>;
  now: Date;
  anyConfigured: boolean;
};

/** "From your accounts": numbers PBOS pulled from the platforms. Each block says where the figures came from and when. */
export function PlatformStatsSection({ views, now, anyConfigured }: PlatformStatsProps) {
  const anyConnected = views.some((v) => v.connected);
  if (!anyConnected) {
    return (
      <EmptyState title="No accounts connected" action={<Link href="/connections" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Open Connections</Link>}>
        Connect YouTube or Instagram and PBOS will pull your channel and post numbers here, straight from their analytics.
        {anyConfigured ? '' : ' (This deployment has no platform keys yet; see the setup notes on the Connections page.)'}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-10">
      {views.filter((v) => v.connected).map(({ view, status }) => (
        <div key={view.platform} aria-labelledby={`${view.platform}-numbers`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 id={`${view.platform}-numbers`} className="text-base">{NAME[view.platform]}</h3>
            <Badge variant="outline">Source: {NAME[view.platform]} API</Badge>
            {view.lastFetchedAt ? <span className="text-xs text-muted-foreground">Updated {timeAgo(view.lastFetchedAt, now)}</span> : null}
            {status === 'needs_reauth' ? <Badge variant="warning">Reconnect needed</Badge> : null}
            <span className="ml-auto"><ActionButton size="sm" variant="secondary" action={syncNow.bind(null, view.platform)} pendingLabel="Syncing…" disabled={status === 'needs_reauth'}>Sync now</ActionButton></span>
          </div>
          {view.hasData ? (
            <>
              <StatStrip stats={view.stats.slice(0, 4).map((s) => ({ label: s.label, value: s.value, hint: s.hint }))} />
              {view.stats.length > 4 ? <StatStrip className="mt-4 border-t-0 pt-0" stats={view.stats.slice(4).map((s) => ({ label: s.label, value: s.value, hint: s.hint }))} /> : null}
              {view.series ? <Bars label={view.series.label} days={view.series.days} /> : null}
            </>
          ) : (
            <EmptyState title={`No ${NAME[view.platform]} numbers yet`}>
              {view.lastFetchedAt ? 'The last sync returned no figures. New accounts and new posts can take a couple of days to show up.' : 'Nothing has been synced yet. Choose Sync now, or wait for the scheduled sync.'}
            </EmptyState>
          )}
        </div>
      ))}
    </div>
  );
}
