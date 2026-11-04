import Link from 'next/link';
import type { ChecklistItem } from '@/lib/get-started';

/** Shown on the dashboard until everything is done, then it disappears. Server component: no state. */
export function GetStarted({ items, done, total, next }: { items: ChecklistItem[]; done: number; total: number; next: ChecklistItem | null }) {
  if (done >= total) return null;
  return (
    <section aria-labelledby="get-started" className="mb-8 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="get-started" className="text-lg">
          Get started
        </h2>
        <p className="text-sm text-muted-foreground">
          {done} of {total} done
        </p>
      </div>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <li key={it.key} className="flex items-start gap-3 text-sm">
            <span aria-hidden="true" className={it.done ? 'mt-0.5 text-primary' : 'mt-0.5 text-muted-foreground'}>
              {it.done ? '✓' : '○'}
            </span>
            <div className="min-w-0">
              {it.done ? (
                <span className="text-muted-foreground line-through">{it.label}</span>
              ) : (
                <Link href={it.href} className="font-medium underline-offset-4 hover:underline">
                  {it.label}
                </Link>
              )}
              <span className="sr-only">{it.done ? ' (done)' : ' (to do)'}</span>
              {!it.done ? <p className="text-xs text-muted-foreground">{it.hint}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      {next ? (
        <p className="mt-4 text-sm">
          Next: <Link href={next.href} className="font-medium underline underline-offset-4">{next.label}</Link>
        </p>
      ) : null}
    </section>
  );
}
