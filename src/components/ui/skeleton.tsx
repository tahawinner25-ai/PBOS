import { cn } from '@/lib/utils';

/** Loading placeholder shape. It carries no numbers or text, so it can never be mistaken for data. */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
