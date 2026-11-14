import { cn } from '@/lib/utils';

/** An empty region says what belongs here and what to do next. It never shows placeholder numbers. */
export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-dashed border-input/60 bg-card/40 px-6 py-10 text-center', className)}>
      <p className="text-lg font-medium">{title}</p>
      {children ? <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
