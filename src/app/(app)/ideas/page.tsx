import type { Metadata } from 'next';
import Link from 'next/link';
import { AddIdeaForm } from '@/components/add-idea-form';
import { DemoBadge } from '@/components/demo-badge';
import { EmptyState } from '@/components/empty-state';
import { IdeaRow } from '@/components/idea-row';
import { PageHeader, Section } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { requireCreator } from '@/lib/auth';
import { buildCalendar, type CalendarDay } from '@/lib/calendar';
import { IDEA_STATUSES, type IdeaStatus } from '@/lib/constants';
import { todayISO } from '@/lib/dates';
import { formatDate, plural } from '@/lib/format';
import type { Idea } from '@/lib/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ideas' };

const STATUS_LABEL: Record<IdeaStatus, string> = {
  idea: 'Idea',
  scripted: 'Scripted',
  scheduled: 'Scheduled',
  posted: 'Posted',
  measured: 'Measured',
};

export default async function IdeasPage({ searchParams: searchParamsPromise }: { searchParams: Promise<{ status?: string }> }) {
  const searchParams = await searchParamsPromise;
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const { data, error } = await supabase.from('ideas').select('*').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(500);
  if (error) throw new Error(`ideas: ${error.message}`);
  const ideas = (data ?? []) as Idea[];

  const filter = (IDEA_STATUSES as readonly string[]).includes(searchParams.status ?? '') ? (searchParams.status as IdeaStatus) : null;
  const counts = Object.fromEntries(IDEA_STATUSES.map((s) => [s, ideas.filter((i) => i.status === s).length])) as Record<IdeaStatus, number>;
  const shown = filter ? ideas.filter((i) => i.status === filter) : ideas;

  const byId = new Map(ideas.map((i) => [i.id, i]));
  const adaptedPlatformsOf = (id: string) =>
    ideas.filter((i) => i.adapted_from === id && i.platform).map((i) => i.platform as string);

  const now = new Date();
  const today = todayISO(now);
  const calendar = buildCalendar(ideas, today);

  return (
    <>
      <PageHeader
        title="Ideas"
        description="Your idea bank and the path each idea takes: idea, scripted, scheduled, posted, measured. Hooks and drafts from AI are suggestions you review."
      />

      <nav aria-label="Pipeline" className="mb-8">
        <ol className="flex flex-wrap items-stretch gap-y-2 border-y border-border">
          <li>
            <Link
              href="/ideas"
              aria-current={filter === null ? 'page' : undefined}
              className={cn('flex h-full flex-col px-4 py-3 text-sm hover:bg-accent/50', filter === null && 'bg-accent')}
            >
              <span className="text-xs text-muted-foreground">All</span>
              <span className="tabular font-serif text-xl">{ideas.length}</span>
            </Link>
          </li>
          {IDEA_STATUSES.map((s) => (
            <li key={s} className="border-l border-border">
              <Link
                href={`/ideas?status=${s}`}
                aria-current={filter === s ? 'page' : undefined}
                className={cn('flex h-full flex-col px-4 py-3 text-sm hover:bg-accent/50', filter === s && 'bg-accent')}
              >
                <span className="text-xs text-muted-foreground">{STATUS_LABEL[s]}</span>
                <span className="tabular font-serif text-xl">{counts[s]}</span>
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      <Section id="add" title="Add an idea" description="Start with the hook. Generate three different angles, pick one, and save the idea to your bank.">
        <details className="group rounded-lg border border-border" open={ideas.length === 0}>
          <summary className="cursor-pointer list-none rounded-lg px-4 py-3 text-sm font-medium hover:bg-accent/40">
            <span className="group-open:hidden">Open the form</span>
            <span className="hidden group-open:inline">Close the form</span>
          </summary>
          <div className="border-t border-border p-4 sm:p-5">
            <AddIdeaForm />
          </div>
        </details>
      </Section>

      <Section id="bank" title={filter ? `${STATUS_LABEL[filter]} ideas` : 'Idea bank'} description={filter ? `${plural(shown.length, 'idea')} with this status.` : undefined}>
        {ideas.length === 0 ? (
          <EmptyState title="Your idea bank is empty">Add your first idea above. Each one moves through the pipeline as you script, schedule, post and measure it.</EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title={`No ${STATUS_LABEL[filter as IdeaStatus].toLowerCase()} ideas`}>
            <Link href="/ideas" className="underline underline-offset-4">
              Show all ideas
            </Link>
          </EmptyState>
        ) : (
          <ul className="ledger" aria-label="Ideas">
            {shown.map((idea) => (
              <IdeaRow
                key={idea.id}
                idea={idea}
                adaptedPlatforms={adaptedPlatformsOf(idea.id)}
                adaptedFromHook={idea.adapted_from ? (byId.get(idea.adapted_from)?.hook ?? null) : null}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section
        id="calendar"
        title="Editorial calendar"
        description="Scheduled ideas that are not posted yet, grouped by date, with the content mix across what is coming up."
      >
        {calendar.upcoming.length === 0 && calendar.slipped.length === 0 ? (
          <EmptyState title="Nothing scheduled">Give an idea a date (open its details) and it appears here.</EmptyState>
        ) : (
          <div className="space-y-6">
            {calendar.mixNote ? <Alert variant="info" title={calendar.mixNote} /> : null}

            {calendar.mix.length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm">Content mix, upcoming</h3>
                <ul className="flex flex-wrap gap-2">
                  {calendar.mix.map((m) => (
                    <li key={m.mix}>
                      <Badge variant="secondary">
                        {m.mix}: {m.count}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {calendar.slipped.length > 0 ? (
              <div>
                <h3 className="mb-1 text-sm">Past their date and not posted</h3>
                <p className="mb-2 text-sm text-muted-foreground">Reschedule these or mark them posted.</p>
                <CalendarDays days={calendar.slipped} />
              </div>
            ) : null}

            {calendar.upcoming.length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm">Coming up</h3>
                <CalendarDays days={calendar.upcoming} />
              </div>
            ) : null}
          </div>
        )}
      </Section>
    </>
  );
}

function CalendarDays({ days }: { days: CalendarDay<Idea>[] }) {
  return (
    <ol className="ledger">
      {days.map((day) => (
        <li key={day.date} className="grid gap-x-6 gap-y-2 py-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
          <h4 className="tabular text-sm font-semibold">{formatDate(day.date)}</h4>
          <ul className="space-y-2">
            {day.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-serif text-base">{i.hook}</span>
                {i.platform ? <Badge variant="secondary">{i.platform}</Badge> : null}
                <Badge variant="outline">{i.content_mix ?? 'No content mix'}</Badge>
                <DemoBadge show={i.is_demo} />
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
