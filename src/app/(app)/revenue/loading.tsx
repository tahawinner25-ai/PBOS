import { Skeleton } from '@/components/ui/skeleton';

export default function RevenueLoading() {
  return (
    <div role="status" aria-label="Loading revenue">
      <Skeleton className="mb-3 h-9 w-36" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-10 h-20 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
