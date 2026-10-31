import { CopyButton } from '@/components/copy-button';
import { DRAFT_DISCLAIMER } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * A generated draft on paper. It is always labelled as a draft, says whether the AI or a template
 * wrote it, and offers copy only: PBOS never sends or publishes anything.
 */
export function DraftSheet({
  title,
  subject,
  body,
  source,
  notice,
  meta,
  children,
  className,
}: {
  title: string;
  subject?: string | null;
  body: string;
  source?: 'ai' | 'llm' | 'rules' | 'template';
  notice?: string | null;
  meta?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const sourceLabel = source === 'ai' || source === 'llm' ? 'Written by AI' : source ? 'Built from a template' : null;
  const copyText = subject ? `Subject: ${subject}\n\n${body}` : body;
  return (
    <article className={cn('paper-sheet p-5 sm:p-6', className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-paper-foreground/15 pb-3">
        <div className="min-w-0">
          <h3 className="font-serif text-lg font-medium">{title}</h3>
          {meta ? <p className="mt-0.5 text-xs text-paper-foreground/70">{meta}</p> : null}
        </div>
        <div className="flex items-center gap-2 text-paper-foreground [&_button]:border-paper-foreground/30 [&_button]:text-paper-foreground [&_button:hover]:bg-paper-foreground/10">
          <CopyButton text={copyText} label="Copy draft" />
        </div>
      </header>
      {subject ? (
        <p className="mb-3 font-serif text-base">
          <span className="text-paper-foreground/70">Subject: </span>
          {subject}
        </p>
      ) : null}
      <div className="paper-body">{body}</div>
      {children ? <div className="mt-4">{children}</div> : null}
      <footer className="mt-5 space-y-1 border-t border-paper-foreground/15 pt-3 text-xs text-paper-foreground/75">
        {sourceLabel ? <p>{sourceLabel}. Review it before you use it.</p> : null}
        {notice ? <p>{notice}</p> : null}
        <p>{DRAFT_DISCLAIMER}</p>
      </footer>
    </article>
  );
}
