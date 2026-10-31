import { Skeleton } from '@/components/ui/skeleton';

export default function LibraryLoading() {
  return (
    <div role="status" aria-label="Loading your library">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-8 h-56 w-full" />
      <div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-56" /><Skeleton className="h-56" /><Skeleton className="h-56" /></div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
