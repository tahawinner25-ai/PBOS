import { Skeleton } from '@/components/ui/skeleton';

export default function StudioLoading() {
  return (
    <div role="status" aria-label="Loading the Studio">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
