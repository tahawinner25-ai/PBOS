import Link from 'next/link';
import { cn } from '@/lib/utils';

/** Wordmark: a small ledger-bar glyph and the name. Original mark, no third-party artwork. */
export function Brand({ href = '/', className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-2 rounded-md font-serif text-lg font-medium tracking-tight', className)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className="size-6 text-primary" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.6" />
        <path d="M8 16V8m4 8v-5m4 5v-8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>PBOS</span>
      <span className="sr-only"> Personal Brand Operating System</span>
    </Link>
  );
}
