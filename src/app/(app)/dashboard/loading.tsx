import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading your dashboard">
      <Skeleton className="mb-3 h-9 w-56" />
      <Skeleton className="mb-8 h-4 w-80 max-w-full" />
      <Skeleton className="mb-3 h-5 w-24" />
      <div className="space-y-3">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
