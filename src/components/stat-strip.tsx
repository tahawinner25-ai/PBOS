import { cn } from '@/lib/utils';

export type Stat = { label: string; value: React.ReactNode; hint?: React.ReactNode };

/** A row of figures separated by rules. Each figure is a real value from the creator's records, or it is not shown. */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-2 gap-x-6 gap-y-5 border-y border-border py-5 sm:grid-cols-4', className)}>
      {stats.map((s) => (
        <div key={s.label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{s.label}</dt>
          <dd className="tabular mt-1 font-serif text-2xl leading-tight">{s.value}</dd>
          {s.hint ? <dd className="mt-1 text-xs text-muted-foreground">{s.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
