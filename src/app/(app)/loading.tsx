import { Skeleton } from '@/components/ui/skeleton';

/** Shown while any page without its own loading screen is being prepared. */
export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="mb-3 h-9 w-40" />
      <Skeleton className="mb-8 h-4 w-80 max-w-full" />
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
