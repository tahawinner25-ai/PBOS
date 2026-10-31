import type { Metadata } from 'next';
import Link from 'next/link';
import { SignOutButton } from '@clerk/nextjs';
import { currentUser } from '@clerk/nextjs/server';
import { AccountDanger } from '@/components/account-danger';
import { PageHeader, Section } from '@/components/page-header';
import { DemoControls, MediaKitAssistant, OfferForm, PersonaForm, ProfileForm, PublishControls } from '@/components/settings-forms';
import { Button } from '@/components/ui/button';
import { requireCreator } from '@/lib/auth';
import { siteUrl } from '@/lib/env';
import { profileCompleteness } from '@/lib/profile';

export const metadata: Metadata = { title: 'Settings' };

/** The primary email on the Clerk account, or null if it cannot be read. */
async function accountEmail(): Promise<string | null> {
  try {
    const user = await currentUser();
    return user?.primaryEmailAddress?.emailAddress ?? null;
  } catch (error) {
    console.error('[settings] could not read the Clerk user:', error instanceof Error ? error.message : error);
    return null;
  }
}

export default async function SettingsPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;
  const email = await accountEmail();

  const { count, error } = await supabase
    .from('ideas')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', profile.id)
    .eq('is_demo', true);
  if (error) throw new Error(`ideas: ${error.message}`);
  const hasDemo = (count ?? 0) > 0;

  const completeness = profileCompleteness(profile);
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, '');
  const avatarUrl = profile.avatar_path && base ? `${base}/storage/v1/object/public/creator-assets/${profile.avatar_path}` : null;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your profile is the source PBOS reads for every recommendation and draft. The more specific it is, the less PBOS has to ask."
        actions={
          <Button asChild variant="outline">
            <Link href="/preview/media-kit">Preview media kit</Link>
          </Button>
        }
      />

      <Section
        id="completeness"
        title="Profile completeness"
        description={`${completeness.done} of ${completeness.total} details filled in.`}
      >
        {completeness.missing.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing missing. PBOS has what it needs to write specific drafts.</p>
        ) : (
          <ul className="ledger text-sm" aria-label="Missing details">
            {completeness.missing.map((m) => (
              <li key={m.field} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-2">
                <span className="font-medium">{m.label}</span>
                <span className="max-w-xl text-muted-foreground">{m.question}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="profile" title="Profile">
        <div className="max-w-2xl">
          <ProfileForm profile={profile} />
        </div>
      </Section>

      <Section id="offer" title="Collaboration options, rates and FAQ" description="Shown on your public media kit. Leave a price blank to say “contact for pricing”.">
        <div className="max-w-2xl">
          <OfferForm profile={profile} />
        </div>
      </Section>

      <Section id="persona" title="AI persona" description="Optional. If you use an AI persona, visitors are always told it is AI.">
        <div className="max-w-2xl">
          <PersonaForm persona={profile.ai_persona} />
        </div>
      </Section>

      <Section id="media-kit" title="Media kit" description="Control whether your public page is live, and add a photo.">
        <div className="max-w-2xl space-y-10">
          <PublishControls published={profile.media_kit_published} avatarUrl={avatarUrl} name={profile.name} publicUrl={`${siteUrl()}/work-with-me`} />
          <div className="space-y-3">
            <h3 className="text-sm">Media kit assistant</h3>
            <MediaKitAssistant />
          </div>
        </div>
      </Section>

      <Section id="demo" title="Demo data">
        <DemoControls hasDemo={hasDemo} />
      </Section>

      <Section id="account" title="Account">
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Signed in as <span className="text-foreground">{email ?? 'your account'}</span>
          </p>
          <SignOutButton redirectUrl="/">
            <Button type="button" variant="outline">
              Sign out
            </Button>
          </SignOutButton>
          <p className="text-xs text-muted-foreground">Use the account menu in the sidebar to change your email, password or sessions.</p>
        </div>
      </Section>

      <Section id="your-data" title="Your data" description="Download a copy, or delete everything.">
        <AccountDanger />
      </Section>
    </>
  );
}
