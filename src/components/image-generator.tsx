'use client';

import { useState } from 'react';
import { generateImage } from '@/actions/images';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Alert } from '@/components/ui/alert';
import { Select, Textarea } from '@/components/ui/input';
import { ASPECTS, IMAGE_PROMPT_MAX, type Aspect } from '@/lib/images/openai';

/** Describe an image, get it back in the library labelled as AI-generated. Nothing is posted from here. */
export function ImageGenerator({ configured, dailyLimit, usedToday }: { configured: boolean; dailyLimit: number; usedToday: number }) {
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<Aspect>('square');
  const left = Math.max(0, dailyLimit - usedToday);

  if (!configured) {
    return (
      <Alert variant="info" title="Image generation is not switched on">
        This deployment has no image provider key yet (OPENAI_API_KEY). Uploading your own images works without it. See docs/INTEGRATIONS.md.
      </Alert>
    );
  }
  return (
    <ActionForm action={generateImage} className="space-y-4" onSuccess={() => setPrompt('')}>
      <Field label="Describe the image" name="prompt" required hint={`${prompt.length}/${IMAGE_PROMPT_MAX}. Say what is in it, the style and the mood. Do not ask for a real person’s likeness or for logos you do not own.`}>
        <Textarea rows={4} maxLength={IMAGE_PROMPT_MAX} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Shape" name="aspect" hint={ASPECTS[aspect].hint}>
          <Select value={aspect} onChange={(e) => setAspect(e.target.value as Aspect)}>
            {(Object.keys(ASPECTS) as Aspect[]).map((a) => <option key={a} value={a}>{ASPECTS[a].label}</option>)}
          </Select>
        </Field>
        <Field label="Quality" name="quality" hint="Higher quality takes longer.">
          <Select defaultValue="medium"><option value="low">Draft</option><option value="medium">Standard</option><option value="high">High</option></Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Generating… this can take up to a minute" disabled={left === 0}>Generate image</SubmitButton>
        <p className="text-xs text-muted-foreground">{left} of {dailyLimit} generations left today. Failed attempts count.</p>
      </div>
      <p className="text-xs text-muted-foreground">The image is saved as AI-generated and stays private to you. When you post it, check that the platform’s own “AI-generated” disclosure setting matches.</p>
    </ActionForm>
  );
}
