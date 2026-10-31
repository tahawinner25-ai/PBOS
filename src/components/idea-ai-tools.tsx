'use client';

import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { adaptIdea, saveHookVariants, saveScript } from '@/actions/ideas';
import { ActionButton } from '@/components/action-button';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { CopyButton } from '@/components/copy-button';
import { DraftSheet } from '@/components/draft-sheet';
import { Options } from '@/components/options';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { callGenerate } from '@/lib/client-generate';
import { FORMATS, PLATFORMS } from '@/lib/constants';
import type { HookVariant, Idea } from '@/lib/types';

/** Generate-and-review hook variants for an existing idea. Nothing is saved until the creator saves it. */
export function HookTools({ idea }: { idea: Pick<Idea, 'id' | 'hook' | 'hook_variants'> }) {
  const [variants, setVariants] = useState<HookVariant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const res = await callGenerate<{ variants: HookVariant[] }>({ kind: 'hooks', idea_id: idea.id });
    if (res.ok) setVariants(res.result.variants);
    else setError(res.error);
    busy.current = false;
    setPending(false);
  }

  const shown = variants ?? idea.hook_variants;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold">Hook variants</h4>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending} aria-busy={pending}>
          <Sparkles aria-hidden="true" />
          {pending ? 'Generating…' : shown.length ? 'Regenerate' : 'Generate 3 variants'}
        </Button>
      </div>
      {error ? <Alert variant="destructive" title={error} /> : null}
      {shown.length > 0 ? (
        <ul className="ledger text-sm">
          {shown.map((v) => (
            <li key={v.angle + v.hook} className="flex flex-wrap items-start justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{v.angle}</p>
                <p className="font-serif text-base leading-snug">{v.hook}</p>
              </div>
              <CopyButton text={v.hook} size="sm" variant="ghost" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No variants yet. Generate three different angles on this hook.</p>
      )}
      {variants ? (
        <div className="flex flex-wrap items-center gap-2">
          <ActionButton size="sm" action={saveHookVariants.bind(null, idea.id, variants)} pendingLabel="Saving…" onSuccess={() => setVariants(null)}>
            Save these variants
          </ActionButton>
          <span className="text-xs text-muted-foreground">AI-generated. Saving replaces the earlier variants.</span>
        </div>
      ) : null}
    </div>
  );
}

/** Draft a script or caption for the idea's own platform. The creator reviews it before it is saved as the script. */
export function ScriptTool({ idea }: { idea: Pick<Idea, 'id' | 'platform' | 'format' | 'script'> }) {
  const [draft, setDraft] = useState<{ caption: string; structure: string | null; source: 'ai' | 'template'; notice: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    if (!idea.platform) {
      setError('Choose a platform for this idea first (edit it above).');
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    const res = await callGenerate<{ caption: string; structure: string | null }>({
      kind: 'caption',
      idea_id: idea.id,
      platform: idea.platform,
      format: idea.format,
    });
    if (res.ok) setDraft({ ...res.result, source: res.source, notice: res.notice });
    else setError(res.error);
    busy.current = false;
    setPending(false);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h4 className="text-sm font-semibold">Script or caption</h4>
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={pending} aria-busy={pending}>
          <Sparkles aria-hidden="true" />
          {pending ? 'Drafting…' : idea.script ? 'Draft a new version' : 'Draft with AI'}
        </Button>
      </div>
      {error ? <Alert variant="destructive" title={error} /> : null}
      {draft ? (
        <DraftSheet
          title={`Draft for ${idea.platform ?? 'this platform'}`}
          body={draft.caption}
          meta={draft.structure ? `Structure: ${draft.structure}` : null}
          source={draft.source}
          notice={draft.notice}
        >
          <div className="flex flex-wrap gap-2">
            <ActionButton size="sm" action={saveScript.bind(null, idea.id, draft.caption)} pendingLabel="Saving…" onSuccess={() => setDraft(null)}>
              Save as the script
            </ActionButton>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)} className="text-paper-foreground hover:bg-paper-foreground/10">
              Discard
            </Button>
          </div>
        </DraftSheet>
      ) : idea.script ? (
        <p className="text-sm text-muted-foreground">A script is saved on this idea. Edit it in the form above.</p>
      ) : (
        <p className="text-sm text-muted-foreground">No script yet. PBOS drafts one from your hook, your voice and the platform’s norms.</p>
      )}
    </div>
  );
}

/**
 * Take one idea to another platform. Each platform needs its own angle: PBOS rejects an adaptation that
 * repeats the source hook or caption, so one post is never pasted across platforms.
 */
export function AdaptForm({ idea, adaptedPlatforms }: { idea: Pick<Idea, 'id' | 'platform' | 'format'>; adaptedPlatforms: string[] }) {
  const available = PLATFORMS.filter((p) => p !== idea.platform && !adaptedPlatforms.includes(p));
  const [platform, setPlatform] = useState<string>(available[0] ?? '');
  const [format, setFormat] = useState<string>(idea.format ?? FORMATS[0]);
  const [angle, setAngle] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  if (available.length === 0) {
    return <p className="text-sm text-muted-foreground">This idea already has an adaptation for every other platform.</p>;
  }

  async function draftCaption() {
    if (busy.current) return;
    if (angle.trim().length < 20) {
      setError('Write the platform-specific angle first (at least 20 characters). The caption is built around it.');
      return;
    }
    busy.current = true;
    setPending(true);
    setError(null);
    const res = await callGenerate<{ caption: string }>({ kind: 'caption', idea_id: idea.id, platform, format, angle: angle.trim() });
    if (res.ok) setCaption(res.result.caption);
    else setError(res.error);
    busy.current = false;
    setPending(false);
  }

  return (
    <ActionForm
      action={adaptIdea}
      className="space-y-4"
      onSuccess={() => {
        setAngle('');
        setCaption('');
        setError(null);
      }}
    >
      <input type="hidden" name="source_id" value={idea.id} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Adapt for" name="platform" required>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <Options values={available} />
          </Select>
        </Field>
        <Field label="Format" name="format" required>
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            <Options values={FORMATS} />
          </Select>
        </Field>
      </div>
      <Field label="Platform-specific angle" name="angle" hint="What changes for this audience or format? It must differ from the source hook." required>
        <Input value={angle} onChange={(e) => setAngle(e.target.value)} maxLength={280} />
      </Field>
      <Field label="Caption" name="caption" hint="Optional. Write your own or draft one with AI, then edit it.">
        <Textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={5} maxLength={5000} />
      </Field>
      {error ? <Alert variant="destructive" title={error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={draftCaption} disabled={pending} aria-busy={pending}>
          <Sparkles aria-hidden="true" />
          {pending ? 'Drafting…' : 'Draft caption with AI'}
        </Button>
        <SubmitButton size="sm" pendingLabel="Adapting…">
          Save adaptation
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
