'use client';

import { useRef, useState } from 'react';
import Image from 'next/image';
import { Sparkles } from 'lucide-react';
import { clearDemoData, seedDemoData } from '@/actions/agent';
import { applyMediaKitProposal, removeAvatar, setPublished, updateOffer, updatePersona, updateProfile, uploadAvatar } from '@/actions/profile';
import { ActionButton } from '@/components/action-button';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { CopyButton } from '@/components/copy-button';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { callGenerate } from '@/lib/client-generate';
import { AI_PERSONA_DISCLOSURE, DEFAULT_CURRENCY } from '@/lib/constants';
import { faqToText, rateCardToText, servicesToText } from '@/lib/profile-text';
import type { MediaKitProposal } from '@/lib/generate/validators';
import type { AiPersona, CreatorProfile } from '@/lib/types';

export function ProfileForm({ profile }: { profile: CreatorProfile }) {
  return (
    <ActionForm key={profile.updated_at} action={updateProfile} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" name="name" required>
          <Input defaultValue={profile.name ?? ''} autoComplete="name" maxLength={80} />
        </Field>
        <Field label="Niche" name="niche" hint="The topic you create about.">
          <Input defaultValue={profile.niche ?? ''} maxLength={120} />
        </Field>
      </div>
      <Field label="Positioning" name="positioning" hint="One sentence: who you help and how.">
        <Input defaultValue={profile.positioning ?? ''} maxLength={200} />
      </Field>
      <Field label="Voice" name="voice" hint="Three words that describe your tone. Drafts follow it.">
        <Input defaultValue={profile.voice ?? ''} maxLength={120} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Main goal, next 90 days" name="goal_primary" hint="In your own words. Recommendations point back to it.">
          <Input defaultValue={profile.goals?.primary ?? ''} maxLength={200} />
        </Field>
        <Field label="Next goal" name="goal_secondary">
          <Input defaultValue={profile.goals?.secondary ?? ''} maxLength={200} />
        </Field>
      </div>
      <Field label="Audience notes" name="audience_notes" hint="Who follows you, in your own words. Leave out numbers unless you can verify them.">
        <Textarea defaultValue={profile.audience_notes ?? ''} rows={3} maxLength={1000} />
      </Field>
      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </ActionForm>
  );
}

export function OfferForm({ profile }: { profile: CreatorProfile }) {
  const currency = profile.rate_card?.[0]?.currency ?? DEFAULT_CURRENCY;
  return (
    <ActionForm key={profile.updated_at} action={updateOffer} className="space-y-4">
      <Field label="Collaboration options" name="services" hint="One per line: Name | short description. Up to 8.">
        <Textarea defaultValue={servicesToText(profile.services ?? [])} rows={5} maxLength={3000} placeholder="Sponsored video | One dedicated short video with a clear call to action" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Rate card" name="rate_card" hint="One per line: Item | price | note. Leave the price blank for “contact for pricing”. Up to 12.">
          <Textarea defaultValue={rateCardToText(profile.rate_card ?? [])} rows={5} maxLength={3000} placeholder="Short video | 1500 | Includes one revision" />
        </Field>
        <Field label="Currency" name="rate_currency" hint="Three letters.">
          <Input defaultValue={currency} maxLength={3} autoCapitalize="characters" pattern="[A-Za-z]{3}" title="Three-letter currency code" />
        </Field>
      </div>
      <Field label="FAQ" name="faq" hint="One per line: Question | Answer. Up to 10. Shown on your media kit.">
        <Textarea defaultValue={faqToText(profile.faq ?? [])} rows={5} maxLength={6000} placeholder="How far ahead should I book? | Reach out at least two weeks before your launch date." />
      </Field>
      <p className="text-xs text-muted-foreground">Prices you publish are an invitation to talk, not a binding offer. Final terms are agreed with each brand in writing.</p>
      <SubmitButton pendingLabel="Saving…">Save offer</SubmitButton>
    </ActionForm>
  );
}

function CheckRow({ name, defaultChecked, children }: { name: string; defaultChecked?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-3 text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 shrink-0 rounded border-input accent-[hsl(var(--primary))]" />
      <span className="leading-snug">{children}</span>
    </label>
  );
}

export function PersonaForm({ persona }: { persona: AiPersona | null }) {
  return (
    <ActionForm key={JSON.stringify(persona)} action={updatePersona} className="space-y-4">
      <Alert variant="info" title="AI personas are always disclosed.">
        {AI_PERSONA_DISCLOSURE} PBOS shows this notice next to the persona on your public page and does not let you switch it off.
      </Alert>
      <CheckRow name="enabled" defaultChecked={persona?.enabled}>
        Show an AI persona section on my public media kit
      </CheckRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Persona name" name="name" hint="Use an invented name, or a real person’s name only with their consent.">
          <Input defaultValue={persona?.name ?? ''} maxLength={60} />
        </Field>
        <Field label="What it does" name="description" hint="For example: answers common brand questions about rates and turnaround.">
          <Input defaultValue={persona?.description ?? ''} maxLength={400} />
        </Field>
      </div>
      <CheckRow name="based_on_real_person" defaultChecked={persona?.based_on_real_person}>
        This persona is based on a real person
      </CheckRow>
      <CheckRow name="consent_confirmed" defaultChecked={persona?.consent_confirmed}>
        I have that person’s consent to represent them this way
      </CheckRow>
      <SubmitButton pendingLabel="Saving…">Save persona</SubmitButton>
    </ActionForm>
  );
}

export function PublishControls({ published, avatarUrl, name, publicUrl }: { published: boolean; avatarUrl: string | null; name: string | null; publicUrl: string }) {
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p className="text-sm">
          {published ? (
            <>
              Your media kit is <strong>public</strong> at <span className="break-all underline underline-offset-4">{publicUrl}</span>.
            </>
          ) : (
            <>
              Your media kit is <strong>private</strong>. Only you can see the preview.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <ActionButton action={setPublished.bind(null, !published)} variant={published ? 'outline' : 'default'} pendingLabel="Saving…">
            {published ? 'Unpublish media kit' : 'Publish media kit'}
          </ActionButton>
          {published ? <CopyButton text={publicUrl} label="Copy public link" /> : null}
        </div>
        {!published ? <p className="text-xs text-muted-foreground">Publishing needs a name, niche and positioning. Review the preview first.</p> : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm">Photo</h3>
        {avatarUrl ? (
          <div className="flex items-center gap-4">
            <Image src={avatarUrl} alt={name ? `Photo of ${name}` : 'Your profile photo'} width={72} height={72} className="size-[72px] rounded-full object-cover" />
            <ActionButton variant="outline" size="sm" action={removeAvatar} pendingLabel="Removing…">
              Remove photo
            </ActionButton>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No photo yet. Add one so your media kit feels personal.</p>
        )}
        <ActionForm action={uploadAvatar} resetOnSuccess className="flex flex-wrap items-end gap-3">
          <Field label={avatarUrl ? 'Replace photo' : 'Upload photo'} name="avatar" hint="JPEG, PNG or WebP, up to 2 MB.">
            <Input type="file" accept="image/jpeg,image/png,image/webp" className="h-auto py-2" />
          </Field>
          <SubmitButton size="sm" pendingLabel="Uploading…">
            Upload
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

/**
 * Suggests media kit copy from the profile. The creator reviews each proposal and chooses what to
 * apply; nothing changes the public page until they press Apply.
 */
export function MediaKitAssistant() {
  const [proposal, setProposal] = useState<{ value: MediaKitProposal; source: 'ai' | 'template'; notice: string | null } | null>(null);
  const [error, setError] = useState<{ message: string; questions: string[] } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);

  async function generate() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    const res = await callGenerate<MediaKitProposal>({ kind: 'mediakit' });
    if (res.ok) setProposal({ value: res.result, source: res.source, notice: res.notice });
    else setError({ message: res.error, questions: (res.missing ?? []).slice(0, 1).map((m) => m.question) });
    busy.current = false;
    setPending(false);
  }

  const v = proposal?.value;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={generate} disabled={pending} aria-busy={pending}>
          <Sparkles aria-hidden="true" />
          {pending ? 'Writing suggestions…' : proposal ? 'Suggest again' : 'Suggest media kit copy'}
        </Button>
        <span className="text-xs text-muted-foreground">AI-generated from your profile. You choose what to apply.</span>
      </div>

      {error ? (
        <Alert variant="destructive" title={error.message}>
          {error.questions.length > 0 ? <p>Next question: {error.questions[0]}</p> : null}
        </Alert>
      ) : null}

      {v ? (
        <ActionForm action={applyMediaKitProposal} className="space-y-4 rounded-lg border border-border p-4" onSuccess={() => setProposal(null)}>
          <input type="hidden" name="positioning_line" value={v.positioning_line ?? ''} />
          <input type="hidden" name="services" value={JSON.stringify(v.services)} />
          <input type="hidden" name="faq" value={JSON.stringify(v.faq)} />
          {v.positioning_line ? (
            <div className="space-y-1">
              <CheckRow name="apply_positioning" defaultChecked>
                Replace my positioning line
              </CheckRow>
              <p className="pl-7 font-serif text-base">{v.positioning_line}</p>
            </div>
          ) : null}
          {v.services.length > 0 ? (
            <div className="space-y-1">
              <CheckRow name="apply_services" defaultChecked>
                Update the descriptions of my existing collaboration options
              </CheckRow>
              <ul className="space-y-1 pl-7 text-sm">
                {v.services.map((s) => (
                  <li key={s.name}>
                    <span className="font-medium">{s.name}:</span> {s.description}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {v.faq.length > 0 ? (
            <div className="space-y-1">
              <CheckRow name="apply_faq" defaultChecked>
                Add these questions to my FAQ
              </CheckRow>
              <ul className="space-y-2 pl-7 text-sm">
                {v.faq.map((f) => (
                  <li key={f.q}>
                    <p className="font-medium">{f.q}</p>
                    <p className="text-muted-foreground">{f.a}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {!v.positioning_line && v.services.length === 0 && v.faq.length === 0 ? (
            <p className="text-sm text-muted-foreground">PBOS had nothing to add beyond what your media kit already says.</p>
          ) : (
            <div className="space-y-2">
              <SubmitButton size="sm" pendingLabel="Applying…">
                Apply selected
              </SubmitButton>
              <p className="text-xs text-muted-foreground">Review before applying. You can edit everything afterwards. {proposal?.notice ?? ''}</p>
            </div>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}

export function DemoControls({ hasDemo }: { hasDemo: boolean }) {
  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-sm text-muted-foreground">
        Demo data fills the app with clearly labelled sample ideas, posts, deals and invoices so you can try the full loop. Every demo row is marked “Demo”, and none of it ever appears on your public media kit. Remove it before you enter your real records.
      </p>
      <div className="flex flex-wrap gap-2">
        {hasDemo ? (
          <ActionButton variant="outline" confirm="Remove all demo ideas, posts, deals and invoices? Your own records are not touched." action={clearDemoData} pendingLabel="Removing…">
            Remove demo data
          </ActionButton>
        ) : (
          <ActionButton variant="outline" action={seedDemoData} pendingLabel="Loading…">
            Load demo data
          </ActionButton>
        )}
      </div>
    </div>
  );
}
