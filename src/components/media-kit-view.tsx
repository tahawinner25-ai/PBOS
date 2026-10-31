import Image from 'next/image';
import { ContactForm } from '@/components/contact-form';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { AI_PERSONA_DISCLOSURE } from '@/lib/constants';
import { formatDate, formatMoney, formatNumber, formatPct, plural } from '@/lib/format';
import type { PublicProfile, PublicProof } from '@/lib/public-kit';

function Missing({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{children}</p>;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

/**
 * The public media kit. Everything here comes from the creator's own profile and real, non-demo posts.
 * In `preview` mode empty sections say what to add instead of disappearing, and the form is switched off.
 */
export function MediaKitView({ profile, proof, contactEmail, preview = false }: { profile: PublicProfile; proof: PublicProof; contactEmail: string | null; preview?: boolean }) {
  const persona = profile.ai_persona;
  return (
    <article>
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6 sm:py-16">
          {profile.avatar_url ? (
            <Image src={profile.avatar_url} alt={`Photo of ${profile.name}`} width={128} height={128} priority className="size-28 shrink-0 rounded-full object-cover sm:size-32" />
          ) : (
            <div aria-hidden="true" className="flex size-28 shrink-0 items-center justify-center rounded-full bg-secondary font-serif text-3xl text-secondary-foreground sm:size-32">
              {initials(profile.name)}
            </div>
          )}
          <div className="min-w-0 space-y-3">
            {preview ? (
              <p className="font-serif text-4xl font-medium tracking-tight sm:text-5xl">{profile.name}</p>
            ) : (
              <h1 className="text-4xl sm:text-5xl">{profile.name}</h1>
            )}
            {profile.positioning ? <p className="font-serif text-xl leading-snug text-muted-foreground">{profile.positioning}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {profile.niche ? <Badge variant="secondary">{profile.niche}</Badge> : null}
              <a href="#contact" className="text-sm font-medium underline underline-offset-4">
                Get in touch
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-14 px-4 py-12 sm:px-6">
        {persona ? (
          <section aria-labelledby="persona-heading" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="persona-heading">Meet {persona.name}</h2>
              <Badge variant="warning">AI-generated persona</Badge>
            </div>
            <p className="leading-relaxed">{persona.description}</p>
            <Alert variant="info" title="This is an AI persona, not a person.">
              {AI_PERSONA_DISCLOSURE}
            </Alert>
          </section>
        ) : null}

        {proof.posts_with_metrics > 0 ? (
          <section aria-labelledby="proof-heading" className="space-y-4">
            <h2 id="proof-heading">Recent results</h2>
            <p className="text-sm text-muted-foreground">
              From {plural(proof.posts_with_metrics, 'post')} with logged results on {proof.platforms.join(', ') || 'the platforms listed'}. These figures are entered by the creator from each platform’s own
              analytics and have not been independently verified.
            </p>
            <Table aria-label="Recent posts and their results">
              <THead>
                <TR>
                  <TH>Post</TH>
                  <TH>Published</TH>
                  <TH className="text-right">Views</TH>
                  <TH className="text-right">Engagement rate</TH>
                </TR>
              </THead>
              <TBody>
                {proof.recent.map((p, i) => (
                  <TR key={`${p.published_at ?? 'undated'}-${i}`}>
                    <TD>{[p.platform, p.format].filter(Boolean).join(', ') || 'Post'}</TD>
                    <TD className="tabular">{formatDate(p.published_at)}</TD>
                    <TD className="tabular text-right">{p.views === null ? 'Not shared' : formatNumber(p.views)}</TD>
                    <TD className="tabular text-right">{p.engagement_rate === null ? 'Not shared' : formatPct(p.engagement_rate)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </section>
        ) : preview ? (
          <section aria-labelledby="proof-heading" className="space-y-3">
            <h2 id="proof-heading">Recent results</h2>
            <Missing>No posts with logged metrics yet, so this section is hidden from visitors. Log results in Analytics and real figures appear here. Demo posts never do.</Missing>
          </section>
        ) : null}

        {profile.services.length > 0 || preview ? (
          <section aria-labelledby="services-heading" className="space-y-3">
            <h2 id="services-heading">Ways to work together</h2>
            {profile.services.length > 0 ? (
              <ul className="ledger">
                {profile.services.map((s) => (
                  <li key={s.name} className="py-3">
                    <h3>{s.name}</h3>
                    {s.description ? <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{s.description}</p> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Missing>No collaboration options yet. Add them in Settings.</Missing>
            )}
          </section>
        ) : null}

        {profile.rate_card.length > 0 || preview ? (
          <section aria-labelledby="rates-heading" className="space-y-3">
            <h2 id="rates-heading">Rate card</h2>
            {profile.rate_card.length > 0 ? (
              <>
                <Table aria-label="Rate card">
                  <THead>
                    <TR>
                      <TH>Deliverable</TH>
                      <TH className="text-right">Starting price</TH>
                      <TH>Notes</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {profile.rate_card.map((r) => (
                      <TR key={r.item}>
                        <TD>{r.item}</TD>
                        <TD className="tabular text-right">{r.price === null ? 'Contact for pricing' : formatMoney(r.price, r.currency)}</TD>
                        <TD className="text-muted-foreground">{r.notes ?? ''}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                <p className="text-xs text-muted-foreground">Prices are a starting point for a conversation, not a binding offer. Final scope, price and terms are agreed in writing with each brand.</p>
              </>
            ) : (
              <Missing>No rate card yet. Add one in Settings, or leave it out and visitors will be asked to get in touch.</Missing>
            )}
          </section>
        ) : null}

        {profile.faq.length > 0 || preview ? (
          <section aria-labelledby="faq-heading" className="space-y-3">
            <h2 id="faq-heading">Frequently asked questions</h2>
            {profile.faq.length > 0 ? (
              <div className="ledger">
                {profile.faq.map((f) => (
                  <details key={f.q} className="group py-3">
                    <summary className="cursor-pointer list-none rounded-md font-medium marker:content-none">
                      <span className="flex items-start justify-between gap-4">
                        {f.q}
                        <span aria-hidden="true" className="text-muted-foreground transition-transform group-open:rotate-45">
                          +
                        </span>
                      </span>
                    </summary>
                    <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                  </details>
                ))}
              </div>
            ) : (
              <Missing>No FAQ yet. Add the questions brands ask you most in Settings.</Missing>
            )}
          </section>
        ) : null}

        <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-8 space-y-4">
          <h2 id="contact-heading">Get in touch</h2>
          {preview ? <Alert variant="info" title="The contact form is switched off in the preview." /> : null}
          <ContactForm disabled={preview} />
          {contactEmail ? (
            <p className="text-sm text-muted-foreground">
              Prefer email?{' '}
              <a href={`mailto:${contactEmail}`} className="text-foreground underline underline-offset-4">
                {contactEmail}
              </a>
            </p>
          ) : null}
        </section>
      </div>
    </article>
  );
}
