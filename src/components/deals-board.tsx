'use client';

import { useEffect, useRef, useState } from 'react';
import { Mail, Pencil } from 'lucide-react';
import { moveDeal } from '@/actions/deals';
import { DealForm } from '@/components/deal-form';
import { DemoBadge } from '@/components/demo-badge';
import { DraftSheet } from '@/components/draft-sheet';
import { Options } from '@/components/options';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { useRunAction } from '@/components/use-run-action';
import { callGenerate } from '@/lib/client-generate';
import { DEAL_STAGES, STALE_DAYS, STAGE_LABEL, type DealStage } from '@/lib/constants';
import { formatDate, formatMoney } from '@/lib/format';
import type { Deal } from '@/lib/types';
import { cn } from '@/lib/utils';

export type BoardDeal = Deal & { daysInStage: number };

type Panel =
  | { mode: 'edit'; dealId: string }
  | { mode: 'draft'; dealId: string; brand: string; subject: string; body: string; source: 'ai' | 'template'; notice: string | null };

const STAGE_OPTIONS = DEAL_STAGES.map((s) => STAGE_LABEL[s]);

/**
 * Pipeline board. Cards drag between columns with the mouse, and every card also has a "Move to"
 * select so keyboard, screen-reader and touch users can change stage. Each move is saved to the database;
 * a failed save puts the card back.
 */
export function DealsBoard({ deals: initial, currency }: { deals: BoardDeal[]; currency: string }) {
  const [deals, setDeals] = useState(initial);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<DealStage | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [genError, setGenError] = useState<{ dealId: string; message: string } | null>(null);
  const { run, pending } = useRunAction();
  const panelRef = useRef<HTMLDivElement>(null);
  const generating = useRef(false);

  // Server data wins whenever it changes (after any revalidation).
  useEffect(() => setDeals(initial), [initial]);

  useEffect(() => {
    if (panel) {
      panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      panelRef.current?.focus();
    }
  }, [panel]);

  async function move(id: string, stage: DealStage) {
    const current = deals.find((d) => d.id === id);
    if (!current || current.stage === stage) return;
    const before = deals;
    setDeals((list) => list.map((d) => (d.id === id ? { ...d, stage, daysInStage: 0 } : d)));
    const ok = await run(() => moveDeal(id, stage));
    if (!ok) setDeals(before);
  }

  async function generateOutreach(deal: BoardDeal) {
    if (generating.current) return;
    generating.current = true;
    setGeneratingId(deal.id);
    setGenError(null);
    const res = await callGenerate<{ subject: string; body: string }>({ kind: 'outreach', deal_id: deal.id });
    if (res.ok) {
      setPanel({ mode: 'draft', dealId: deal.id, brand: deal.brand ?? 'this brand', subject: res.result.subject, body: res.result.body, source: res.source, notice: res.notice });
    } else {
      setGenError({ dealId: deal.id, message: res.error });
    }
    generating.current = false;
    setGeneratingId(null);
  }

  const editing = panel?.mode === 'edit' ? deals.find((d) => d.id === panel.dealId) : null;

  return (
    <div>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-max grid-flow-col auto-cols-[16.5rem] gap-3 lg:min-w-0 lg:grid-flow-row lg:grid-cols-5 lg:auto-cols-auto">
          {DEAL_STAGES.map((stage) => {
            const inStage = deals.filter((d) => d.stage === stage);
            const total = inStage.reduce((sum, d) => sum + (d.value ?? 0), 0);
            return (
              <section
                key={stage}
                aria-label={`${STAGE_LABEL[stage]} column`}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverStage(stage);
                }}
                onDragLeave={() => setOverStage((s) => (s === stage ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData('text/plain') || dragId;
                  setOverStage(null);
                  setDragId(null);
                  if (id) void move(id, stage);
                }}
                className={cn('flex min-h-40 flex-col rounded-lg border border-border bg-card/40 p-2 transition-colors', overStage === stage && 'border-primary bg-primary/5')}
              >
                <header className="mb-2 px-1">
                  <h3 className="flex items-baseline justify-between text-sm">
                    {STAGE_LABEL[stage]}
                    <span className="tabular text-xs font-normal text-muted-foreground">{inStage.length}</span>
                  </h3>
                  {total > 0 ? <p className="tabular text-xs text-muted-foreground">{formatMoney(total, currency)}</p> : null}
                </header>
                <ul className="flex flex-1 flex-col gap-2">
                  {inStage.length === 0 ? <li className="px-1 py-4 text-center text-xs text-muted-foreground">No deals</li> : null}
                  {inStage.map((d) => {
                    const stale = stage !== 'paid' && d.daysInStage >= STALE_DAYS;
                    return (
                      <li
                        key={d.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', d.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setDragId(d.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverStage(null);
                        }}
                        className={cn('cursor-grab rounded-md border border-border bg-background p-3 text-sm active:cursor-grabbing', dragId === d.id && 'opacity-50')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words font-medium leading-snug">{d.brand ?? 'Unnamed brand'}</p>
                          <DemoBadge show={d.is_demo} />
                        </div>
                        <p className="tabular mt-1 text-muted-foreground">{d.value === null ? 'Value not set' : formatMoney(d.value, currency)}</p>
                        <dl className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                          <div className="flex justify-between gap-2">
                            <dt>Expected close</dt>
                            <dd className="tabular text-foreground">{d.expected_close_date ? formatDate(d.expected_close_date) : 'Not set'}</dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>In this stage</dt>
                            <dd className="tabular">
                              {stale ? <Badge variant="warning">{d.daysInStage} days</Badge> : <span className="text-foreground">{d.daysInStage === 1 ? '1 day' : `${d.daysInStage} days`}</span>}
                            </dd>
                          </div>
                        </dl>
                        {d.deliverables.length > 0 ? (
                          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                            {d.deliverables.slice(0, 3).map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                            {d.deliverables.length > 3 ? <li>and {d.deliverables.length - 3} more</li> : null}
                          </ul>
                        ) : null}
                        <div className="mt-3 space-y-2">
                          <Select
                            aria-label={`Move ${d.brand ?? 'deal'} to another stage`}
                            className="h-8 text-xs"
                            value={STAGE_LABEL[d.stage]}
                            disabled={pending}
                            onChange={(e) => {
                              const next = DEAL_STAGES.find((s) => STAGE_LABEL[s] === e.target.value);
                              if (next) void move(d.id, next);
                            }}
                          >
                            <Options values={STAGE_OPTIONS} />
                          </Select>
                          <div className="flex flex-wrap gap-1">
                            <Button type="button" size="sm" variant="outline" className="h-8 px-2 text-xs" disabled={generatingId === d.id} aria-busy={generatingId === d.id} onClick={() => void generateOutreach(d)}>
                              <Mail aria-hidden="true" />
                              {generatingId === d.id ? 'Drafting…' : 'Generate outreach email'}
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => setPanel({ mode: 'edit', dealId: d.id })}>
                              <Pencil aria-hidden="true" />
                              Edit
                            </Button>
                          </div>
                          {genError?.dealId === d.id ? <p role="alert" className="text-xs font-medium text-destructive">{genError.message}</p> : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Drag a card to another column, or use its “Move” menu. Days in stage restart whenever a deal moves.</p>

      {panel ? (
        <div ref={panelRef} tabIndex={-1} className="mt-8 rounded-lg border border-border bg-card/50 p-4 outline-none sm:p-5" aria-label={panel.mode === 'edit' ? 'Edit deal' : 'Outreach draft'}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="text-base">{panel.mode === 'edit' ? `Edit ${editing?.brand ?? 'deal'}` : `Outreach email for ${panel.brand}`}</h3>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
              Close
            </Button>
          </div>
          {panel.mode === 'edit' ? (
            editing ? (
              <DealForm deal={editing} onDone={() => setPanel(null)} />
            ) : (
              <Alert variant="info" title="This deal no longer exists." />
            )
          ) : (
            <DraftSheet title={`To ${panel.brand}`} subject={panel.subject} body={panel.body} source={panel.source} notice={panel.notice} />
          )}
        </div>
      ) : null}
    </div>
  );
}
