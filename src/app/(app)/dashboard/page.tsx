import type { Metadata } from 'next';
import Link from 'next/link';
import { respondToSuggestion } from '@/actions/agent';
import { ActionButton } from '@/components/action-button';
import { DraftSheet } from '@/components/draft-sheet';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { RunLoopButton } from '@/components/run-loop-button';
import { SourceLinks } from '@/components/source-links';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buildDailyPlan } from '@/lib/agent/daily';
import { composeDashboard, latestRun } from '@/lib/agent/run-view';
import { resolveSource } from '@/lib/agent/sources';
import { requireCreator } from '@/lib/auth';
import { plural, timeAgo } from '@/lib/format';
import { AGENT_CRITICAL_FIELDS, goalSummary, missingProfileFields } from '@/lib/profile';
import { loadAgentData } from '@/lib/server/data';

export const metadata: Metadata = { title: 'Dashboard' };

const DRAFT_TITLE: Record<string, string> = {
  invoices_overdue: 'Overdue invoice follow-up',
  deals_stale: 'Outreach email for a stalled deal',
  format_followup: 'Follow-up hook for your best format',
  ideas_stale: 'Script for an idea that has been waiting',
};

const DECISION_LABEL = { accepted: 'Accepted', ignored: 'Ignored' } as const;

export default async function DashboardPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { profile, supabase } = ctx;

  const now = new Date();
  const data = await loadAgentData(supabase, profile);
  const plan = buildDailyPlan(data, now);
  const run = latestRun(data.events);
  const view = composeDashboard(run, plan, now);

  const goal = goalSummary(profile);
  const nextQuestion = missingProfileFields(profile).find((f) => AGENT_CRITICAL_FIELDS.includes(f.field));
  const hasRecords = plan.hasRecords;
  const hasFindings = view.flags.length > 0;
  const shownDraft = view.draft;

  return (
    <>
      <PageHeader
        title={profile.name ? `Today, ${profile.name.split(' ')[0]}` : 'Today'}
        description={
          <>
            {profile.niche ? <span>Niche: {profile.niche}. </span> : null}
            {goal ? <span>Goal: {goal}</span> : <span>No goal set yet. Add one in Settings so recommendations can point to it.</span>}
          </>
        }
        actions={<RunLoopButton creatorId={profile.id} hasRun={Boolean(run)} />}
      />

      {nextQuestion ? (
        <Alert variant="info" title={nextQuestion.question} className="mb-8">
          PBOS asks for one missing detail at a time instead of guessing it.{' '}
          <Link href="/settings" className="font-medium">
            Answer in Settings
          </Link>
        </Alert>
      ) : null}

      <p className="mb-8 text-sm text-muted-foreground" role="status">
        {view.runAt ? (
          <>
            Last run {timeAgo(view.runAt, now)}
            {run?.source === 'rules' ? ' (rule-based wording)' : ''}.
            {view.stale ? ' That was more than a day ago, so refresh before you act.' : ''}
          </>
        ) : (
          'The loop has not run yet. The flags below come straight from your records; run the loop for recommendations and a draft.'
        )}
        {view.resolved > 0 ? ` ${plural(view.resolved, 'earlier suggestion')} no longer applies, so ${view.resolved === 1 ? 'it was' : 'they were'} removed.` : ''}
      </p>

      {!hasRecords ? (
        <EmptyState
          title="Nothing to scan yet"
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link href="/ideas">Add an idea</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/deals">Add a deal</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/revenue">Log an invoice</Link>
              </Button>
            </div>
          }
        >
          PBOS only works from records you enter: ideas, posts, deals and invoices. Add a few, or load clearly-labelled demo data from Settings to see the loop work.
        </EmptyState>
      ) : !hasFindings ? (
        <EmptyState title="All checks passed">
          Nothing in your ideas, posts, deals or invoices needs attention right now. PBOS will flag it here when something does.
        </EmptyState>
      ) : (
        <>
          <Section id="flags" title="Flags" description="Facts found by scanning your records. Each one links to the records behind it.">
            <ul className="ledger" aria-label="Flags">
              {view.flags.map((f) => (
                <li key={f.key} className="flex flex-wrap items-start gap-x-4 gap-y-2 py-3">
                  <Badge variant="outline" className="mt-0.5 shrink-0">
                    {f.pillar}
                  </Badge>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm leading-relaxed">{f.message}</p>
                    <SourceLinks refs={f.source_record_ids.map((id) => resolveSource(id, data))} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" />
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            id="recommendations"
            title="Recommended next actions"
            description="Up to three, ranked by what your records say matters most. Accepting records your decision; you still do the work yourself."
          >
            {view.suggestions.length > 0 ? (
              <ol className="ledger" aria-label="Recommendations">
                {view.suggestions.map((s) => (
                  <li key={s.event_id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{s.pillar}</Badge>
                      {s.decision ? <Badge variant={s.decision === 'accepted' ? 'success' : 'secondary'}>{DECISION_LABEL[s.decision]}</Badge> : null}
                    </div>
                    <p className="font-serif text-lg leading-snug">{s.action}</p>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">Why: </span>
                      {s.reason}
                    </p>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">Source data</p>
                      <SourceLinks refs={s.source_record_ids.map((id) => resolveSource(id, data))} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button asChild variant="outline" size="sm">
                        <Link href={s.href}>Open the records</Link>
                      </Button>
                      {!s.decision ? (
                        <>
                          <ActionButton size="sm" action={respondToSuggestion.bind(null, s.event_id, 'accepted')} pendingLabel="Saving…">
                            Accept
                          </ActionButton>
                          <ActionButton size="sm" variant="ghost" action={respondToSuggestion.bind(null, s.event_id, 'ignored')} pendingLabel="Saving…">
                            Ignore
                          </ActionButton>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : view.newFindings.length === 0 ? (
              <EmptyState title="No open recommendations">
                Every current finding is either paused by your recent Accept or Ignore choices or already handled. The flags above are still true.
              </EmptyState>
            ) : null}

            {view.newFindings.length > 0 ? (
              <div className={view.suggestions.length > 0 ? 'mt-6' : undefined}>
                <h3 className="mb-1 text-sm">{view.suggestions.length > 0 ? 'Found since the last run' : 'Found in your records'}</h3>
                <p className="mb-2 text-sm text-muted-foreground">Run the loop to confirm these, get wording, and store them so you can accept or ignore them.</p>
                <ul className="ledger" aria-label="Findings not yet reviewed">
                  {view.newFindings.map((c) => (
                    <li key={c.key} className="space-y-1.5 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{c.pillar}</Badge>
                        <span className="text-sm">{c.action}</span>
                      </div>
                      <p className="text-sm text-muted-foreground">{c.reason}</p>
                      <SourceLinks refs={c.source_record_ids.map((id) => resolveSource(id, data))} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>

          <Section id="draft" title="Drafted for you" description="The single highest-value asset for today. Edit it, then send or post it yourself.">
            {shownDraft ? (
              <DraftSheet
                title={DRAFT_TITLE[shownDraft.key] ?? 'Draft'}
                body={shownDraft.content}
                meta={shownDraft.platform ? `For ${shownDraft.platform}` : null}
                source={run?.source === 'llm' ? 'llm' : 'rules'}
              >
                <div className="space-y-1 text-xs text-paper-foreground/75">
                  <p className="font-medium text-paper-foreground">Built from</p>
                  <SourceLinks refs={shownDraft.source_record_ids.map((id) => resolveSource(id, data))} className="flex flex-wrap items-center gap-x-4 gap-y-1" />
                </div>
              </DraftSheet>
            ) : (
              <EmptyState title="No draft yet">
                {run ? 'Today’s findings do not call for a draft, or the draft did not pass PBOS’s checks. Refresh the loop to try again.' : 'Run the daily loop and PBOS will draft the most useful asset for your records.'}
              </EmptyState>
            )}
          </Section>
        </>
      )}

      {plan.feedback.notes.length > 0 ? (
        <Section id="learning" title="What PBOS learned from your choices">
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {plan.feedback.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
