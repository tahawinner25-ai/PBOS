'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { dbFail, fail, ok, withCreator } from '@/lib/action-helpers';
import { getSessionContext } from '@/lib/auth';
import { sniffMedia } from '@/lib/media-sniff';
import { faqFromText, rateCardFromText, servicesFromText } from '@/lib/profile-text';
import type { ActionResult, AiPersona, FaqItem, Goals, Service } from '@/lib/types';
import { signupGate } from '@/lib/server/signup-guard';
import { parse, rules } from '@/lib/validation';

function revalidateProfile() {
  ['/settings', '/dashboard', '/work-with-me', '/preview/media-kit'].forEach((p) => revalidatePath(p));
}

/** First-run onboarding. The account owner creates their one creator profile. */
export async function createProfile(formData: FormData): Promise<ActionResult> {
  const ctx = await getSessionContext();
  if (!ctx.configured) return fail('Sign-in or the database is not configured. See the README.');
  if (!ctx.user) return fail('Sign in first.');
  if (ctx.profile) redirect('/dashboard');

  // Single-creator guard, enforced on the server so it cannot be skipped from the browser.
  const gate = await signupGate();
  if (!gate.open) return fail(gate.reason);

  const parsed = parse(
    formData,
    {
      name: rules.text({ max: 80 }),
      niche: rules.optionalText({ max: 120 }),
      positioning: rules.optionalText({ max: 200 }),
      voice: rules.optionalText({ max: 120 }),
      goal_primary: rules.optionalText({ max: 200 }),
    },
    { name: 'Name', niche: 'Niche', positioning: 'Positioning', voice: 'Voice', goal_primary: 'Goal' },
  );
  if (!parsed.ok) return fail(parsed.first, parsed.errors);

  const d = parsed.data;
  const goals: Goals = d.goal_primary ? { primary: d.goal_primary } : {};
  const { error } = await ctx.supabase.from('creator_profile').insert({
    user_id: ctx.user.id,
    name: d.name,
    niche: d.niche,
    positioning: d.positioning,
    voice: d.voice,
    goals,
  });
  // 23505: the profile already exists (double submit). Continue to the dashboard.
  if (error && error.code !== '23505') return dbFail('createProfile', error);
  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function updateProfile(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        name: rules.text({ max: 80 }),
        niche: rules.optionalText({ max: 120 }),
        positioning: rules.optionalText({ max: 200 }),
        voice: rules.optionalText({ max: 120 }),
        goal_primary: rules.optionalText({ max: 200 }),
        goal_secondary: rules.optionalText({ max: 200 }),
        audience_notes: rules.optionalText({ max: 1000 }),
      },
      { name: 'Name', goal_primary: 'Primary goal', goal_secondary: 'Next goal', audience_notes: 'Audience notes' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;
    const goals: Goals = {
      ...(d.goal_primary ? { primary: d.goal_primary } : {}),
      ...(d.goal_secondary ? { secondary: d.goal_secondary } : {}),
    };
    const { error } = await supabase
      .from('creator_profile')
      .update({ name: d.name, niche: d.niche, positioning: d.positioning, voice: d.voice, goals, audience_notes: d.audience_notes })
      .eq('id', profile.id);
    if (error) return dbFail('updateProfile', error);
    revalidateProfile();
    return ok('Profile saved.');
  });
}

export async function updateOffer(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        services: rules.optionalText({ max: 3000 }),
        rate_card: rules.optionalText({ max: 3000 }),
        rate_currency: rules.optionalText({ max: 3 }),
        faq: rules.optionalText({ max: 6000 }),
      },
      { services: 'Collaboration options', rate_card: 'Rate card', rate_currency: 'Currency', faq: 'FAQ' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);

    const currency = (parsed.data.rate_currency ?? 'USD').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) return fail('Currency must be a 3-letter code such as USD or EUR.', { rate_currency: 'Use a 3-letter code such as USD or EUR.' });

    const services = servicesFromText(parsed.data.services ?? '');
    if (!services.ok) return fail(services.error, { services: services.error });
    const rate = rateCardFromText(parsed.data.rate_card ?? '', currency);
    if (!rate.ok) return fail(rate.error, { rate_card: rate.error });
    const faq = faqFromText(parsed.data.faq ?? '');
    if (!faq.ok) return fail(faq.error, { faq: faq.error });

    const { error } = await supabase
      .from('creator_profile')
      .update({ services: services.value, rate_card: rate.value, faq: faq.value })
      .eq('id', profile.id);
    if (error) return dbFail('updateOffer', error);
    revalidateProfile();
    return ok('Collaboration options, rate card and FAQ saved.');
  });
}

export async function updatePersona(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const parsed = parse(
      formData,
      {
        enabled: rules.boolean(),
        name: rules.optionalText({ max: 60 }),
        description: rules.optionalText({ max: 400 }),
        based_on_real_person: rules.boolean(),
        consent_confirmed: rules.boolean(),
      },
      { name: 'Persona name', description: 'Persona description' },
    );
    if (!parsed.ok) return fail(parsed.first, parsed.errors);
    const d = parsed.data;

    if (d.enabled && (!d.name || !d.description)) {
      return fail('Give the persona a name and a short description before enabling it.');
    }
    if (d.enabled && d.based_on_real_person && !d.consent_confirmed) {
      return fail('A persona based on a real person needs that person’s consent. Confirm consent, or untick “based on a real person”.', {
        consent_confirmed: 'Consent is required for personas based on a real person.',
      });
    }
    const persona: AiPersona | null =
      d.name || d.description
        ? {
            enabled: d.enabled,
            name: d.name ?? '',
            description: d.description ?? '',
            based_on_real_person: d.based_on_real_person,
            consent_confirmed: d.consent_confirmed,
          }
        : null;
    const { error } = await supabase.from('creator_profile').update({ ai_persona: persona }).eq('id', profile.id);
    if (error) return dbFail('updatePersona', error);
    revalidateProfile();
    return ok(d.enabled ? 'AI persona saved. It will always be disclosed as AI-generated on your media kit.' : 'AI persona saved but not shown publicly.');
  });
}

export async function setPublished(published: boolean): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (published) {
      const missing = [
        !profile.name?.trim() && 'name',
        !profile.niche?.trim() && 'niche',
        !profile.positioning?.trim() && 'positioning',
      ].filter(Boolean);
      if (missing.length > 0) return fail(`Add your ${missing.join(', ')} before publishing the media kit.`);
    }
    const { error } = await supabase.from('creator_profile').update({ media_kit_published: Boolean(published) }).eq('id', profile.id);
    if (error) return dbFail('setPublished', error);
    revalidateProfile();
    return ok(published ? 'Published. /work-with-me is now public.' : 'Unpublished. /work-with-me is now private.');
  });
}

const AVATAR_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function uploadAvatar(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, user, profile }) => {
    const file = formData.get('avatar');
    if (!(file instanceof Blob) || file.size === 0) return fail('Choose an image to upload.', { avatar: 'Choose an image to upload.' });
    if (file.size > 2 * 1024 * 1024) return fail('The image must be 2 MB or smaller.', { avatar: 'The image must be 2 MB or smaller.' });
    // The browser's Content-Type is only a claim. This bucket is public, so check the real bytes before storing.
    const sniffed = sniffMedia(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    const ext = sniffed && sniffed.kind === 'image' ? AVATAR_TYPES[sniffed.mime] : undefined;
    if (!sniffed || !ext) return fail('Use a JPEG, PNG or WebP image.', { avatar: 'Use a JPEG, PNG or WebP image.' });

    const path = `${user.id}/avatar-${Date.now()}.${ext}`;
    const up = await supabase.storage.from('creator-assets').upload(path, file, { contentType: sniffed.mime, upsert: false });
    if (up.error) {
      console.error('[storage] upload', up.error.message);
      return fail('The upload failed. Check that the creator-assets bucket exists (run the storage migration).');
    }
    const { error } = await supabase.from('creator_profile').update({ avatar_path: path }).eq('id', profile.id);
    if (error) {
      await supabase.storage.from('creator-assets').remove([path]);
      return dbFail('uploadAvatar', error);
    }
    if (profile.avatar_path) await supabase.storage.from('creator-assets').remove([profile.avatar_path]);
    revalidateProfile();
    return ok('Photo updated.');
  });
}

export async function removeAvatar(): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    if (!profile.avatar_path) return ok();
    const { error } = await supabase.from('creator_profile').update({ avatar_path: null }).eq('id', profile.id);
    if (error) return dbFail('removeAvatar', error);
    await supabase.storage.from('creator-assets').remove([profile.avatar_path]);
    revalidateProfile();
    return ok('Photo removed.');
  });
}

/**
 * Applies AI media kit proposals the creator reviewed. Nothing is written until they press apply.
 * Services only update descriptions of options that already exist; FAQ entries are appended.
 */
export async function applyMediaKitProposal(formData: FormData): Promise<ActionResult> {
  return withCreator(async ({ supabase, profile }) => {
    const positioning = String(formData.get('positioning_line') ?? '').trim();
    const applyPositioning = formData.get('apply_positioning') === 'on' && positioning.length > 0 && positioning.length <= 200;

    let proposedServices: Service[] = [];
    let proposedFaq: FaqItem[] = [];
    try {
      const s = JSON.parse(String(formData.get('services') ?? '[]'));
      const f = JSON.parse(String(formData.get('faq') ?? '[]'));
      proposedServices = Array.isArray(s) ? s.filter((x) => x && typeof x.name === 'string' && typeof x.description === 'string') : [];
      proposedFaq = Array.isArray(f) ? f.filter((x) => x && typeof x.q === 'string' && typeof x.a === 'string') : [];
    } catch {
      return fail('The proposal could not be read. Generate it again.');
    }

    const update: Record<string, unknown> = {};
    if (applyPositioning) update.positioning = positioning;
    if (formData.get('apply_services') === 'on') {
      update.services = (profile.services ?? []).map((existing) => {
        const match = proposedServices.find((p) => p.name.trim().toLowerCase() === existing.name.trim().toLowerCase());
        return match ? { ...existing, description: match.description.slice(0, 240) } : existing;
      });
    }
    if (formData.get('apply_faq') === 'on') {
      const have = new Set((profile.faq ?? []).map((f) => f.q.trim().toLowerCase()));
      const additions = proposedFaq.filter((f) => !have.has(f.q.trim().toLowerCase())).map((f) => ({ q: f.q.slice(0, 160), a: f.a.slice(0, 600) }));
      update.faq = [...(profile.faq ?? []), ...additions].slice(0, 10);
    }
    if (Object.keys(update).length === 0) return fail('Select at least one proposal to apply.');

    const { error } = await supabase.from('creator_profile').update(update).eq('id', profile.id);
    if (error) return dbFail('applyMediaKitProposal', error);
    revalidateProfile();
    return ok('Applied. Review the result in the sections above.');
  });
}
