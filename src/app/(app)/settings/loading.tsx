import { Skeleton } from '@/components/ui/skeleton';

export default function SettingsLoading() {
  return (
    <div role="status" aria-label="Loading settings">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
