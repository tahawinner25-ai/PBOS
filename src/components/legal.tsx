import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { contactEmail } from '@/lib/env';
import { unresolvedPlaceholders } from '@/lib/company';

export const LEGAL_UPDATED = 'October 24, 2026';

/**
 * Flip to true only after a qualified lawyer has reviewed these pages for the operator's jurisdiction
 * (see docs/LEGAL-REVIEW.md). Until then every legal page says so, in plain view.
 */
export const LEGAL_REVIEWED = false;

/** Prose wrapper for legal pages: readable measure, serif headings from the base styles. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  const email = contactEmail();
  const missing = unresolvedPlaceholders();
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
      <h1 className="mb-2">{title}</h1>
      <p className="mb-6 text-sm text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
      {!LEGAL_REVIEWED || missing.length > 0 ? (
        <Alert variant="warning" title="Draft pending legal review." className="mb-8">
          This page describes how PBOS works today. It has not yet been reviewed by a lawyer, and details in [square brackets] are still to be filled in by the operator.
        </Alert>
      ) : null}
      <div className="space-y-8 leading-relaxed [&_h2]:mb-2 [&_h2]:mt-0 [&_li]:mt-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:text-muted-foreground [&_p]:max-w-prose [&_table]:w-full [&_td]:align-top [&_td]:py-2 [&_td]:pr-3 [&_th]:py-2 [&_th]:pr-3 [&_th]:text-left [&_a]:underline [&_a]:underline-offset-4">{children}</div>
      <p className="mt-10 border-t border-border pt-6 text-sm text-muted-foreground">
        Questions about this page? {email ? <a href={`mailto:${email}`} className="text-foreground underline underline-offset-4">{email}</a> : 'Use the contact form on the media kit page.'}{' '}
        <Link href="/" className="underline underline-offset-4">
          Back to the home page
        </Link>
      </p>
    </main>
  );
}
