import type { Metadata } from 'next';
import Link from 'next/link';
import { Flight } from '@/components/flight';
import { LandingSheets } from '@/components/landing-sheets';
import { PublicShell } from '@/components/public-shell';
import { Button } from '@/components/ui/button';
import { clerkConfigured } from '@/lib/env';

export const metadata: Metadata = {
  title: { absolute: 'PBOS: the Personal Brand Operating System for creators' },
  description:
    'PBOS reads your ideas, posts, deals, invoices and connected YouTube and Instagram accounts, flags what needs attention and why, and does the prep work for you to approve. It never publishes without your approval and never invents a number.',
  alternates: { canonical: '/' },
};

/** Names of the five sheets, in order. The sheets themselves carry the copy (landing-sheets.tsx). */
const STEP_NAMES = ['Scan', 'Flag', 'Suggest', 'Draft', 'Learn'] as const;

const PILLARS = [
  { name: 'Ideation', text: 'Keep an idea bank, get three different hook angles for each idea, and adapt it for each platform with its own angle instead of pasting one post everywhere.' },
  { name: 'Posting', text: 'Connect YouTube and Instagram, prepare posts with your video or image, and approve each one. YouTube holds scheduled videos for you; Instagram posts are sent at the time you chose. Nothing goes out without your approval.' },
  { name: 'Analytics', text: 'Numbers synced from your connected accounts, or logged by you, labelled by where they came from. If data is missing the screen says so and tells you what to connect or log.' },
  { name: 'Deals', text: 'A pipeline from prospecting to paid with days in each stage, and outreach emails drafted from the deal record.' },
  { name: 'Revenue', text: 'Track invoices by hand. See collected, outstanding and overdue, plus a weighted pipeline labelled as an estimate, not guaranteed income.' },
  { name: 'Create', text: 'Generate images, draft ad copy that fits Meta and YouTube limits, and keep every file in one library. Drafts only: PBOS never spends your money.' },
  { name: 'Studio', text: 'Cut, join and caption short videos in your browser, then export for Reels, Shorts or a feed post. Your footage stays on your device while you edit. Only a finished video you choose to save is uploaded.' },
] as const;

const WONT = [
  'Publish, send or pay for anything without your approval.',
  'Send emails or invoices, or collect payment.',
  'Invent metrics, audience sizes or revenue. An empty screen means there is no data yet.',
  'Promise growth, reach, brand deals or income.',
  'Pass AI-generated images or personas off as real. They are labelled.',
] as const;

const FAQ = [
  { q: 'Who is PBOS for?', a: 'Creators running their own brand. Each account is a private workspace for one creator; other creators can never see your records.' },
  { q: 'Does it connect to Instagram and YouTube?', a: 'Yes. You can connect both to publish what you approve and to sync your numbers. You choose the permissions on Google’s and Meta’s own consent screens, and you can disconnect and delete the synced data at any time. TikTok is not connected; you log those numbers yourself.' },
  { q: 'Will it post or email for me?', a: 'It posts to YouTube or Instagram only after you approve that specific post. It never sends email: it drafts, and you send.' },
  { q: 'Where does the AI come in?', a: 'The checks are plain rules run on your records. AI words the findings and writes drafts. The in-app agent can also do work for you: it reads your workspace and makes new ideas, drafts, images and ad copy, and anything that would change an existing record waits for your approval. It cannot publish, send, pay or delete. Its reply is checked against your data before you see it, and if the check fails PBOS shows a plain account of what was actually done instead.' },
  { q: 'Is my data private?', a: 'Every record belongs to your account and is protected by row-level security in the database. Connection tokens are encrypted and never sent to your browser. You can download everything or delete your account in Settings. The privacy policy has the details.' },
  { q: 'What does the revenue forecast mean?', a: 'The weighted pipeline multiplies each open deal’s value by a fixed probability for its stage: 10% prospecting, 40% negotiating, 80% contracted. It is an estimate, not guaranteed income.' },
  { q: 'Can I try it without signing up?', a: 'Yes. Open the 10-minute demo: a sample workspace with a real countdown that locks when time is up. Inside a real workspace you can also load clearly labelled demo data from Settings and remove it in one click.' },
] as const;

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'PBOS',
  alternateName: 'Personal Brand Operating System',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description: 'An operating system for creators that reads your ideas, posts, deals, invoices and connected accounts, flags what needs attention and drafts the next asset for approval.',
};

/** Text version of the film, for people who cannot see or hear it (WCAG 1.2). Keep it in step with tools/showreel/storyboard.md. */
const FILM_TRANSCRIPT =
  'A card reading “A hook worth testing” breaks into creator clutter: drafts, view counts, a deal, an invoice. IDEAS: it becomes a content card for YouTube and Instagram. POSTS: cards line up into a weekly calendar, with some slots left open. PERFORMANCE: the calendar turns into bars; one bar leads, and PBOS suggests drafting one more like it. DEALS: that insight becomes a brand-deal card that moves from prospecting to won. INCOME: the deal becomes a short timeline (won, invoiced, paid) and you mark it paid yourself. Then everything folds into one command, Scan, Flag, Draft, Send, with the note “You approve every send.” The film ends on “PBOS: Personal Brand Operating System” and loops. Every shape is an illustration; there are no real numbers.';

export default function LandingPage() {
  // Sign-up only makes sense once sign-in is configured. Until then the demo is the primary way in, so nobody lands on a dead end.
  const signInOpen = clerkConfigured();
  return (
    <PublicShell theme="desk">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, '\\u003c') }} />
      <main id="main" tabIndex={-1}>
        <Flight
          labels={STEP_NAMES}
          hero={
            <div className="mx-auto max-w-5xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
              <h1 className="max-w-[19ch] text-[clamp(2.5rem,6.4vw,4.75rem)] font-medium leading-[1.02] tracking-tight">One operating system for one creator.</h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
                PBOS reads your ideas, posts, deals, invoices and connected YouTube and Instagram accounts, flags what needs attention and why, and does the prep work for you to approve. It never publishes without your approval and never invents a number.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {signInOpen ? (
                  <>
                    <Button asChild size="lg">
                      <Link href="/signup">Create your account</Link>
                    </Button>
                    <Button asChild size="lg" variant="ghost">
                      <Link href="/demo">Try the 10-minute demo</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <Button asChild size="lg">
                      <Link href="/demo">Try the 10-minute demo</Link>
                    </Button>
                    <p className="text-sm text-muted-foreground">Accounts are not open yet. The demo needs no sign-up.</p>
                  </>
                )}
              </div>
              <p className="mt-10 text-sm text-muted-foreground">
                Keep scrolling to follow one daily review, or{' '}
                <a href="#film" className="rounded-sm text-foreground underline underline-offset-4">
                  watch the 15-second film
                </a>
                .
              </p>
            </div>
          }
        >
          <LandingSheets />
        </Flight>

        <section id="film" aria-labelledby="film-heading" className="scroll-mt-8 border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <h2 id="film-heading" className="mb-2 text-3xl">
              The whole loop in 15 seconds
            </h2>
            <p className="mb-6 max-w-2xl text-muted-foreground">
              One idea becomes a post, a result, a deal and tracked income. Shapes and words only, so there are no real numbers in it. Nothing plays until you press play.
            </p>
            {/* No autoplay: a moving picture with sound should start only when the visitor asks. */}
            <video
              className="aspect-video w-full rounded-lg border border-border bg-black"
              controls
              playsInline
              preload="none"
              poster="/showreel/poster.jpg"
              aria-describedby="film-transcript"
            >
              <source src="/showreel/showreel.mp4" type="video/mp4" />
              Your browser cannot play this video. <a href="/showreel/showreel.mp4">Download the MP4 (3 MB)</a>.
            </video>
            <details className="mt-3 text-sm text-muted-foreground">
              <summary className="cursor-pointer rounded-md py-1 font-medium text-foreground">Read the film as text</summary>
              <p id="film-transcript" className="mt-2 max-w-prose leading-relaxed">
                {FILM_TRANSCRIPT}
              </p>
            </details>
          </div>
        </section>

        <section aria-labelledby="pillars-heading" className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
            <h2 id="pillars-heading" className="mb-8 text-3xl">
              Seven areas, one view
            </h2>
            <ul className="ledger">
              {PILLARS.map((p) => (
                <li key={p.name} className="grid gap-x-8 gap-y-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <h3 className="font-serif text-lg font-medium">{p.name}</h3>
                  <p className="max-w-2xl text-muted-foreground">{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-labelledby="wont-heading" className="border-t border-border">
          <div className="mx-auto grid max-w-5xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-x-8">
            <h2 id="wont-heading" className="text-3xl lg:text-2xl">
              What PBOS will not do
            </h2>
            <ul className="max-w-2xl list-disc space-y-2 pl-5 text-muted-foreground marker:text-primary">
              {WONT.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-8 border-t border-border">
          <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6">
            <h2 id="faq-heading" className="mb-6 text-3xl">
              Frequently asked questions
            </h2>
            <div className="ledger">
              {FAQ.map((f) => (
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
          </div>
        </section>

        <section aria-labelledby="cta-heading" className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6 px-4 py-14 sm:px-6">
            <h2 id="cta-heading" className="text-3xl">
              Start with one idea.
            </h2>
            <Button asChild size="lg">
              {signInOpen ? <Link href="/signup">Create your account</Link> : <Link href="/demo">Try the 10-minute demo</Link>}
            </Button>
          </div>
        </section>
      </main>
    </PublicShell>
  );
}
