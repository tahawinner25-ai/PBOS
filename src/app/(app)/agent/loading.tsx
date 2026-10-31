import { Skeleton } from '@/components/ui/skeleton';

export default function AgentLoading() {
  return (
    <div role="status" aria-label="Loading the agent">
      <Skeleton className="mb-3 h-9 w-32" />
      <Skeleton className="mb-8 h-4 w-96 max-w-full" />
      <Skeleton className="mb-8 h-32 w-full" />
      <Skeleton className="h-48 w-full" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
