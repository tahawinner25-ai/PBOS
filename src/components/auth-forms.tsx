'use client';

import { createProfile } from '@/actions/profile';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Input } from '@/components/ui/input';

export function OnboardingForm() {
  return (
    <ActionForm action={createProfile} className="space-y-4" toastOnSuccess={false}>
      <Field label="Name" name="name" hint="Shown on your media kit and signed on outreach drafts." required>
        <Input autoComplete="name" maxLength={80} />
      </Field>
      <Field label="Niche" name="niche" hint="For example: personal finance for freelancers.">
        <Input maxLength={120} />
      </Field>
      <Field label="Positioning" name="positioning" hint="One sentence: who you help and how.">
        <Input maxLength={200} />
      </Field>
      <Field label="Voice" name="voice" hint="Three words, such as direct, warm, practical.">
        <Input maxLength={120} />
      </Field>
      <Field label="Main goal for the next 90 days" name="goal_primary" hint="State it in your own words. PBOS does not promise or predict outcomes.">
        <Input maxLength={200} />
      </Field>
      <SubmitButton className="w-full" pendingLabel="Creating profile…">
        Create profile
      </SubmitButton>
    </ActionForm>
  );
}
