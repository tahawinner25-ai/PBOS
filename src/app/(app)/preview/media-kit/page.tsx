import type { Metadata } from 'next';
import Link from 'next/link';
import { MediaKitView } from '@/components/media-kit-view';
import { PageHeader } from '@/components/page-header';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { requireCreator } from '@/lib/auth';
import { contactEmail } from '@/lib/env';
import { buildProof, toPublicProfile } from '@/lib/public-kit';
import type { Post } from '@/lib/types';

export const metadata: Metadata = { title: 'Media kit preview' };

export default async function MediaKitPreviewPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const { data, error } = await supabase
    .from('posts')
    .select('*')
    .eq('creator_id', profile.id)
    .eq('is_demo', false)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(100);
  if (error) throw new Error(`posts: ${error.message}`);

  const pub = toPublicProfile(profile, process.env.NEXT_PUBLIC_SUPABASE_URL);

  return (
    <>
      <PageHeader
        title="Media kit preview"
        description="Exactly what visitors will see at /work-with-me, built from your profile and your real posts. Demo data is never shown."
        actions={
          <Button asChild variant="outline">
            <Link href="/settings#media-kit">{profile.media_kit_published ? 'Manage publishing' : 'Publish in Settings'}</Link>
          </Button>
        }
      />

      {profile.media_kit_published ? (
        <Alert variant="success" title="Your media kit is public." className="mb-6">
          <Link href="/work-with-me">Open the public page</Link>
        </Alert>
      ) : (
        <Alert variant="warning" title="Your media kit is private." className="mb-6">
          Visitors get a 404 until you publish it in Settings.
        </Alert>
      )}

      {pub ? (
        <div className="theme-paper overflow-hidden rounded-lg border border-border bg-background text-foreground">
          <MediaKitView profile={pub} proof={buildProof((data ?? []) as Post[])} contactEmail={contactEmail()} preview />
        </div>
      ) : (
        <Alert variant="info" title="Add your name first.">
          The media kit needs at least a name. <Link href="/settings#profile">Open your profile</Link>
        </Alert>
      )}
    </>
  );
}
