'use client';

import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { Turnstile, resetTurnstile } from '@/components/turnstile';
import { Input, Textarea } from '@/components/ui/input';
import type { ActionResult } from '@/lib/types';

/** Posts to /api/contact and maps the JSON answer onto the shared form states (pending, field errors, success). */
async function sendInquiry(formData: FormData): Promise<ActionResult> {
  const payload = Object.fromEntries(Array.from(formData.entries()).filter(([, v]) => typeof v === 'string'));
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; fieldErrors?: Record<string, string> } | null;
    if (res.ok && body?.ok) return { ok: true, message: 'Message sent. You will get a reply by email if it is a fit.' };
    return { ok: false, error: body?.error ?? 'Your message could not be sent. Please try again in a moment.', fieldErrors: body?.fieldErrors };
  } catch {
    return { ok: false, error: 'Could not reach the server. Check your connection and try again.' };
  } finally {
    // A Turnstile token is single-use, so the next attempt needs a fresh one.
    resetTurnstile();
  }
}

export function ContactForm({ disabled = false }: { disabled?: boolean }) {
  // Public by design: the site key is meant for browsers. The secret key stays on the server.
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return (
    <ActionForm action={sendInquiry} className="space-y-4" resetOnSuccess inlineSuccess>
      <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" name="name" required>
            <Input autoComplete="name" maxLength={120} />
          </Field>
          <Field label="Email" name="email" required>
            <Input type="email" autoComplete="email" inputMode="email" maxLength={254} />
          </Field>
        </div>
        <Field label="Company or brand" name="company">
          <Input autoComplete="organization" maxLength={160} />
        </Field>
        <Field label="What would you like to work on?" name="message" hint="At least 10 characters. Include timing and the deliverables you have in mind." required>
          <Textarea rows={5} minLength={10} maxLength={4000} />
        </Field>
        {/* Honeypot: hidden from people and assistive tech. Bots fill it in; the server then discards the message. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label>
            Leave this field empty
            <input type="text" name="website" tabIndex={-1} autoComplete="off" />
          </label>
        </div>
        {turnstileSiteKey && !disabled ? <Turnstile siteKey={turnstileSiteKey} /> : null}
        <SubmitButton pendingLabel="Sending…">Send message</SubmitButton>
        <p className="text-xs text-muted-foreground">Your message and email address go only to this creator, who may reply by email. See the privacy policy for how it is stored.</p>
      </fieldset>
    </ActionForm>
  );
}
