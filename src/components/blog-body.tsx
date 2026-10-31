import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { Block } from '@/lib/blog';

/** Renders blog blocks as plain, semantic HTML. Text is never interpreted as markup. */
export function BlogBody({ blocks }: { blocks: readonly Block[] }) {
  return (
    <div className="space-y-5 leading-relaxed [&_p]:max-w-prose">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'h2':
            return (
              <h2 key={i} className="mb-0 mt-10 text-2xl">
                {b.text}
              </h2>
            );
          case 'p':
            return <p key={i}>{b.text}</p>;
          case 'ul':
            return (
              <ul key={i} className="max-w-prose list-disc space-y-2 pl-5 marker:text-primary">
                {b.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            );
          case 'note':
            return (
              <aside key={i} className="max-w-prose rounded-lg border border-border bg-muted/50 p-4 text-sm">
                <p className="mb-1 font-medium">{b.title}</p>
                <p className="text-muted-foreground">{b.text}</p>
              </aside>
            );
          case 'link':
            return (
              <p key={i}>
                <Link href={b.href} className="inline-flex items-center gap-1.5 font-medium text-primary underline underline-offset-4">
                  {b.label}
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </p>
            );
        }
      })}
    </div>
  );
}
