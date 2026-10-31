import { Skeleton } from '@/components/ui/skeleton';

export default function PublishLoading() {
  return (
    <div role="status" aria-label="Loading Publish">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-8 h-72 w-full" />
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
