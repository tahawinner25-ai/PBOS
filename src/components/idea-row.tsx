'use client';

import { useId, useState } from 'react';
import { deleteIdea, setIdeaStatus, updateIdea } from '@/actions/ideas';
import { ActionButton } from '@/components/action-button';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { DemoBadge } from '@/components/demo-badge';
import { AdaptForm, HookTools, ScriptTool } from '@/components/idea-ai-tools';
import { Options } from '@/components/options';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useRunAction } from '@/components/use-run-action';
import { CONTENT_MIX, FORMATS, IDEA_STATUSES, PLATFORMS } from '@/lib/constants';
import { formatDate } from '@/lib/format';
import type { Idea } from '@/lib/types';

export function IdeaRow({ idea, adaptedPlatforms, adaptedFromHook }: { idea: Idea; adaptedPlatforms: string[]; adaptedFromHook: string | null }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { run, pending } = useRunAction();

  return (
    <li className="py-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-lg leading-snug">{idea.hook || 'Untitled idea'}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {idea.platform ? <Badge variant="secondary">{idea.platform}</Badge> : null}
            {idea.format ? <Badge variant="outline">{idea.format}</Badge> : null}
            {idea.content_mix ? <Badge variant="outline">{idea.content_mix}</Badge> : null}
            {idea.scheduled_for ? <Badge variant="default">Scheduled {formatDate(idea.scheduled_for)}</Badge> : null}
            <DemoBadge show={idea.is_demo} />
          </div>
          {adaptedFromHook ? <p className="mt-1.5 text-xs text-muted-foreground">Adapted from “{adaptedFromHook}”</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <Select
            aria-label={`Status of ${idea.hook ?? 'idea'}`}
            className="h-9 w-36"
            value={idea.status}
            disabled={pending}
            onChange={(e) => void run(() => setIdeaStatus(idea.id, e.target.value))}
          >
            <Options values={IDEA_STATUSES} />
          </Select>
          <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Details'}
          </Button>
        </div>
      </div>

      {open ? (
        <div id={panelId} className="mt-4 space-y-8 rounded-lg border border-border bg-card/50 p-4 sm:p-5">
          <section aria-label="Edit idea">
            <h4 className="mb-3 text-sm font-semibold">Edit</h4>
            <ActionForm key={idea.updated_at} action={updateIdea} className="space-y-4">
              <input type="hidden" name="id" value={idea.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Platform" name="platform" required>
                  <Select defaultValue={idea.platform ?? PLATFORMS[0]}>
                    <Options values={PLATFORMS} />
                  </Select>
                </Field>
                <Field label="Format" name="format" required>
                  <Select defaultValue={idea.format ?? FORMATS[0]}>
                    <Options values={FORMATS} />
                  </Select>
                </Field>
              </div>
              <Field label="Hook" name="hook" required>
                <Input defaultValue={idea.hook ?? ''} maxLength={280} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Content mix" name="content_mix">
                  <Select defaultValue={idea.content_mix ?? ''}>
                    <Options values={CONTENT_MIX} placeholder="Not set" />
                  </Select>
                </Field>
                <Field label="Schedule for" name="scheduled_for">
                  <Input type="date" defaultValue={idea.scheduled_for ?? ''} />
                </Field>
              </div>
              <Field label="Script or caption" name="script">
                <Textarea defaultValue={idea.script ?? ''} rows={6} maxLength={5000} />
              </Field>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </ActionForm>
          </section>

          <section aria-label="Hook variants">
            <HookTools idea={idea} />
          </section>

          <section aria-label="Script drafting">
            <ScriptTool idea={idea} />
          </section>

          <section aria-label="Adapt for another platform">
            <h4 className="mb-1 text-sm font-semibold">Adapt for another platform</h4>
            <p className="mb-3 text-sm text-muted-foreground">Each platform gets its own angle. PBOS will not accept a copy of this idea.</p>
            <AdaptForm idea={idea} adaptedPlatforms={adaptedPlatforms} />
          </section>

          <div className="border-t border-border pt-4">
            <ActionButton variant="outline" size="sm" confirm="Delete this idea? Posts created from it are kept." action={deleteIdea.bind(null, idea.id)} pendingLabel="Deleting…">
              Delete idea
            </ActionButton>
          </div>
        </div>
      ) : null}
    </li>
  );
}
