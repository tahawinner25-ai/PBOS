'use client';

import { useState } from 'react';
import { generateAdVariants, saveAdDraft, type AdBrief } from '@/actions/ads';
import { ActionButton } from '@/components/action-button';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { CopyButton } from '@/components/copy-button';
import { Alert } from '@/components/ui/alert';
import { Input, Select, Textarea } from '@/components/ui/input';
import { AD_AUDIENCE_MAX, AD_FORMATS, AD_FORMAT_KEYS, AD_OFFER_MAX, OBJECTIVES, adAsText, type AdFormatKey, type AdVariant } from '@/lib/ads';

type ImageOption = { id: string; label: string; ai: boolean };

function Counter({ value, max }: { value: string; max: number }) {
  const over = value.length > max;
  return <span className={over ? 'text-destructive' : 'text-muted-foreground'}>{value.length}/{max}{over ? ' (too long)' : ''}</span>;
}

function VariantCard({ initial, brief, images }: { initial: AdVariant; brief: AdBrief; images: ImageOption[] }) {
  const spec = AD_FORMATS[brief.format];
  const [v, setV] = useState<AdVariant>(initial);
  const [imageId, setImageId] = useState('');
  const set = (k: keyof AdVariant) => (e: { target: { value: string } }) => setV((p) => ({ ...p, [k]: e.target.value }));
  const over = v.headline.length > spec.limits.headline || v.primary_text.length > spec.limits.primary || (spec.fields.description !== null && v.description.length > spec.limits.description);
  return (
    <li className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">Angle: {initial.angle}</p>
        <span className="text-xs text-muted-foreground">AI-generated draft. Edit freely.</span>
      </div>
      <label className="block text-sm"><span className="mb-1 flex justify-between"><span>{spec.fields.headline}</span><Counter value={v.headline} max={spec.limits.headline} /></span>
        <Input value={v.headline} onChange={set('headline')} /></label>
      <label className="block text-sm"><span className="mb-1 flex justify-between"><span>{spec.fields.primary}</span><Counter value={v.primary_text} max={spec.limits.primary} /></span>
        <Textarea rows={3} value={v.primary_text} onChange={set('primary_text')} /></label>
      {spec.fields.description !== null ? (
        <label className="block text-sm"><span className="mb-1 flex justify-between"><span>{spec.fields.description}</span><Counter value={v.description} max={spec.limits.description} /></span>
          <Input value={v.description} onChange={set('description')} /></label>
      ) : null}
      <label className="block text-sm"><span className="mb-1 block">Button</span>
        <Select value={v.cta} onChange={set('cta')}>{spec.ctas.map((c) => <option key={c} value={c}>{c}</option>)}</Select></label>
      {images.length > 0 ? (
        <label className="block text-sm"><span className="mb-1 block">Image from your library (optional)</span>
          <Select value={imageId} onChange={(e) => setImageId(e.target.value)}><option value="">None</option>{images.map((i) => <option key={i.id} value={i.id}>{i.label}{i.ai ? ' (AI-generated)' : ''}</option>)}</Select></label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <ActionButton size="sm" disabled={over} action={() => saveAdDraft({ brief, variant: v, mediaAssetId: imageId || null })} pendingLabel="Saving…">Save draft</ActionButton>
        <CopyButton text={adAsText(v, brief.format)} size="sm" variant="ghost" />
        {over ? <span className="text-xs text-destructive">Shorten the highlighted fields to save.</span> : null}
      </div>
    </li>
  );
}

export function AdsStudio({ aiReady, images, hasProfileAudience }: { aiReady: boolean; images: ImageOption[]; hasProfileAudience: boolean }) {
  const [format, setFormat] = useState<AdFormatKey>('meta_feed');
  const [offer, setOffer] = useState('');
  const [result, setResult] = useState<{ variants: AdVariant[]; brief: AdBrief; n: number } | null>(null);

  if (!aiReady) {
    return <Alert variant="info" title="AI drafting is not switched on">This deployment has no AI key yet (ANTHROPIC_API_KEY), so PBOS cannot draft ad copy. It will not fill in placeholder copy instead.</Alert>;
  }
  return (
    <div className="space-y-6">
      <ActionForm action={generateAdVariants} className="space-y-4" toastOnSuccess={false} onSuccess={(r) => { const d = r.data as { variants: AdVariant[]; brief: AdBrief } | undefined; if (d) setResult({ ...d, n: (result?.n ?? 0) + 1 }); }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Where will it run?" name="format" hint={AD_FORMATS[format].note}>
            <Select value={format} onChange={(e) => setFormat(e.target.value as AdFormatKey)}>{AD_FORMAT_KEYS.map((k) => <option key={k} value={k}>{AD_FORMATS[k].label}</option>)}</Select>
          </Field>
          <Field label="What is it for?" name="objective"><Select defaultValue={OBJECTIVES[3]}>{OBJECTIVES.map((o) => <option key={o} value={o}>{o}</option>)}</Select></Field>
        </div>
        <Field label="What are you promoting?" name="offer" required hint={`${offer.length}/${AD_OFFER_MAX}. State the real offer: what it is, the price or discount if any, any deadline. The copy can only use what you write here.`}>
          <Textarea rows={4} maxLength={AD_OFFER_MAX} value={offer} onChange={(e) => setOffer(e.target.value)} />
        </Field>
        <Field label="Who is it for?" name="audience" hint={hasProfileAudience ? `Optional: your profile’s audience notes are used if you leave this empty. Up to ${AD_AUDIENCE_MAX} characters.` : `One sentence. Up to ${AD_AUDIENCE_MAX} characters.`}>
          <Input maxLength={AD_AUDIENCE_MAX} />
        </Field>
        <SubmitButton pendingLabel="Drafting three versions…">{result ? 'Draft again' : 'Draft 3 versions'}</SubmitButton>
      </ActionForm>

      {result ? (
        <div className="space-y-3" aria-live="polite">
          <h3 className="text-base">Drafts for {AD_FORMATS[result.brief.format].label}</h3>
          <ul className="grid gap-4 lg:grid-cols-3">{result.variants.map((v) => <VariantCard key={`${result.n}-${v.angle}`} initial={v} brief={result.brief} images={images} />)}</ul>
        </div>
      ) : null}
    </div>
  );
}
