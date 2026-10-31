import { Skeleton } from '@/components/ui/skeleton';

export default function AdsLoading() {
  return (
    <div role="status" aria-label="Loading Ads">
      <Skeleton className="mb-3 h-9 w-28" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-8 h-64 w-full" />
      <Skeleton className="h-24 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
