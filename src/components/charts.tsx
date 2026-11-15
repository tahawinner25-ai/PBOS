import { cn } from '@/lib/utils';

export type BarItem = { label: string; value: number; display?: string; tone?: 'primary' | 'success' | 'warning' | 'danger' | 'muted' };

const TONE: Record<NonNullable<BarItem['tone']>, string> = {
  primary: 'bg-gradient-to-t from-primary to-[hsl(217_95%_68%)]',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  muted: 'bg-muted-foreground/40',
};

/**
 * A small bar chart drawn with plain HTML, so it stays crisp and readable at any size. It is drawn even when every value is 0:
 * a zero is a real number and gets a visible baseline and a "0" label. The same numbers sit in a table for screen readers.
 */
export function BarChart({ title, items, caption, className, height = 140 }: { title: string; items: BarItem[]; caption?: string; className?: string; height?: number }) {
  const max = Math.max(...items.map((i) => i.value), 0);
  return (
    <figure className={cn('surface p-4', className)}>
      <figcaption className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        {caption ? <span className="text-xs text-muted-foreground">{caption}</span> : null}
      </figcaption>
      <div className="flex items-end gap-2" style={{ height }} aria-hidden="true">
        {items.map((i) => (
          <div key={i.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <span className="tabular text-xs text-muted-foreground">{i.display ?? i.value.toLocaleString('en-US')}</span>
            <div className={cn('w-full max-w-14 rounded-t', TONE[i.tone ?? 'primary'], i.value === 0 && 'bg-muted-foreground/30')} style={{ height: max > 0 && i.value > 0 ? `${Math.max(4, (i.value / max) * 100)}%` : 2 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 border-t border-border pt-1" aria-hidden="true">
        {items.map((i) => <span key={i.label} className="min-w-0 flex-1 truncate text-center text-xs text-muted-foreground">{i.label}</span>)}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead><tr><th scope="col">Item</th><th scope="col">Value</th></tr></thead>
        <tbody>{items.map((i) => <tr key={i.label}><td>{i.label}</td><td>{i.display ?? i.value}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** A big number with a label, for the headline of a chart block ("0 invoices"). */
export function BigNumber({ value, label, className }: { value: string; label: string; className?: string }) {
  return (
    <p className={cn('flex items-baseline gap-2', className)}>
      <span className="text-gradient tabular text-5xl font-semibold tracking-tight">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </p>
  );
}
