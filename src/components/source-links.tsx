import Link from 'next/link';
import { DemoBadge } from '@/components/demo-badge';
import type { SourceRef } from '@/lib/agent/sources';

/** The data a recommendation or draft was built from, as links back to the records. */
export function SourceLinks({ refs, className }: { refs: SourceRef[]; className?: string }) {
  if (refs.length === 0) return null;
  return (
    <ul className={className ?? 'flex flex-wrap items-center gap-x-4 gap-y-1 text-xs'}>
      {refs.map((r) => (
        <li key={r.id} className="inline-flex items-center gap-1.5">
          <Link href={r.href} className="underline underline-offset-4 hover:text-foreground">
            {r.label}
          </Link>
          <DemoBadge show={r.isDemo} />
        </li>
      ))}
    </ul>
  );
}
