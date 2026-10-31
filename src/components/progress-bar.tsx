import { cn } from '@/lib/utils';

/** Determinate progress bar. The bar itself is a progressbar role; the text is not a live region, so screen readers are not flooded with updates. */
export function ProgressBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className={cn('space-y-1', className)}>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none" style={{ width: `${value}%` }} />
      </div>
      <p className="tabular text-xs text-muted-foreground" >{label}: {value}%</p>
    </div>
  );
}
