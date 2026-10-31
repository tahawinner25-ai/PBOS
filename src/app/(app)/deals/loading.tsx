import { Skeleton } from '@/components/ui/skeleton';

export default function DealsLoading() {
  return (
    <div role="status" aria-label="Loading deals">
      <Skeleton className="mb-3 h-9 w-32" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-48 w-full" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
