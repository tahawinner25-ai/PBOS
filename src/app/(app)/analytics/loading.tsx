import { Skeleton } from '@/components/ui/skeleton';

export default function AnalyticsLoading() {
  return (
    <div role="status" aria-label="Loading analytics">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-10 h-20 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
