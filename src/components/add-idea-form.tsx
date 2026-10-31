'use client';

import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { createIdea } from '@/actions/ideas';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Options } from '@/components/options';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { callGenerate } from '@/lib/client-generate';
import { CONTENT_MIX, FORMATS, PLATFORMS } from '@/lib/constants';
import type { HookVariant } from '@/lib/types';

/**
 * Add an idea to the bank. "Generate hook variants" asks the server for three genuinely different
 * angles; picking one fills the hook field, and all three are saved with the idea.
 */
export function AddIdeaForm() {
  const [hook, setHook] = useState('');
  const [platform, setPlatform] = useState<string>(PLATFORMS[0]);
  const [format, setFormat] = useState<string>(FORMATS[0]);
  const [variants, setVariants] = useState<HookVariant[]>([]);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    if (hook.trim().length < 5) {
      setGenError('Type your core hook first (at least 5 characters). The variants are built from it.');
      return;
    }
    busy.current = true;
    setGenerating(true);
    setGenError(null);
    const res = await callGenerate<{ variants: HookVariant[] }>({ kind: 'hooks', hook: hook.trim(), platform, format });
    if (res.ok) setVariants(res.result.variants);
    else setGenError(res.error);
    busy.current = false;
    setGenerating(false);
  }

  return (
    <ActionForm
      action={createIdea}
      className="space-y-4"
      resetOnSuccess
      onSuccess={() => {
        setHook('');
        setPlatform(PLATFORMS[0]);
        setFormat(FORMATS[0]);
        setVariants([]);
        setGenError(null);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Platform" name="platform" required>
          <Select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <Options values={PLATFORMS} />
          </Select>
        </Field>
        <Field label="Format" name="format" required>
          <Select value={format} onChange={(e) => setFormat(e.target.value)}>
            <Options values={FORMATS} />
          </Select>
        </Field>
      </div>

      <Field label="Hook" name="hook" hint="The opening line or core idea, 5 to 280 characters." required>
        <Input value={hook} onChange={(e) => setHook(e.target.value)} maxLength={280} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={generate} disabled={generating} aria-busy={generating}>
          <Sparkles aria-hidden="true" />
          {generating ? 'Generating…' : variants.length ? 'Regenerate hook variants' : 'Generate 3 hook variants'}
        </Button>
        <span className="text-xs text-muted-foreground">AI-generated. Review before you use them.</span>
      </div>
      {genError ? <Alert variant="destructive" title={genError} /> : null}

      {variants.length > 0 ? (
        <fieldset className="space-y-2 rounded-lg border border-border p-4">
          <legend className="px-1 text-sm font-medium">Pick the angle to use as your hook</legend>
          <ul className="space-y-2">
            {variants.map((v) => (
              <li key={v.angle + v.hook} className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{v.angle}</p>
                  <p className="font-serif text-base leading-snug">{v.hook}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setHook(v.hook)}>
                  Use this hook
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">All three variants are saved with the idea.</p>
        </fieldset>
      ) : null}
      <input type="hidden" name="hook_variants" value={JSON.stringify(variants)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Content mix" name="content_mix" hint="Optional. Helps balance your calendar.">
          <Select defaultValue="">
            <Options values={CONTENT_MIX} placeholder="Not set" />
          </Select>
        </Field>
        <Field label="Schedule for" name="scheduled_for" hint="Optional. Setting a date marks the idea as scheduled.">
          <Input type="date" />
        </Field>
      </div>

      <SubmitButton pendingLabel="Adding…">Add idea</SubmitButton>
    </ActionForm>
  );
}
