import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { EmptyState } from '@/components/empty-state';
import { PageHeader, Section } from '@/components/page-header';
import { PublishComposer } from '@/components/publish-composer';
import { PublishQueue, type QueueJob } from '@/components/publish-queue';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { requireCreator } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { MediaAssetRow } from '@/lib/integrations/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Publish' };
export const dynamic = 'force-dynamic';
// Approving an Instagram post can wait for Instagram to process the media, so give the action room.
export const maxDuration = 60;

const JOB_COLUMNS = 'id, platform, format, title, caption, privacy, scheduled_for, media_asset_ids, status, progress, upload_offset, external_url, last_error, error_code, created_at, published_at';

export default async function PublishPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  const [conns, jobsRes, mediaRes, ideasRes] = await Promise.all([
    supabase.from('social_connections').select('platform, status').eq('creator_id', profile.id),
    supabase.from('publish_jobs').select(JOB_COLUMNS).eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(40),
    supabase.from('media_assets').select('id, kind, mime_type, label, ai_generated, storage_path, bucket').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(60),
    supabase.from('ideas').select('id, hook').eq('creator_id', profile.id).neq('status', 'measured').order('created_at', { ascending: false }).limit(100),
  ]);
  for (const r of [conns, jobsRes, mediaRes, ideasRes]) if (r.error) throw new Error(`publish: ${r.error.message}`);

  const connRows = (conns.data ?? []) as Array<{ platform: 'youtube' | 'instagram'; status: string }>;
  const connected = { youtube: connRows.some((c) => c.platform === 'youtube' && c.status === 'active'), instagram: connRows.some((c) => c.platform === 'instagram' && c.status === 'active') };
  const jobs = (jobsRes.data ?? []) as unknown as QueueJob[];
  const mediaRows = (mediaRes.data ?? []) as unknown as Array<MediaAssetRow & { bucket: string }>;

  // Short-lived preview links for the picker (images only). Created on the server; they expire in 10 minutes.
  const admin = createAdminClient();
  const previews = new Map<string, string>();
  if (admin) {
    await Promise.all(mediaRows.filter((m) => m.kind === 'image').slice(0, 24).map(async (m) => {
      const signed = await admin.storage.from(m.bucket).createSignedUrl(m.storage_path, 600);
      if (signed.data?.signedUrl) previews.set(m.id, signed.data.signedUrl);
    }));
  }
  const media = mediaRows.map((m) => ({ id: m.id, kind: m.kind, mime_type: m.mime_type, label: m.label, ai_generated: m.ai_generated, storage_path: m.storage_path, previewUrl: previews.get(m.id) ?? null }));

  const active = jobs.some((j) => j.status === 'uploading' || j.status === 'processing');
  const hasScheduledInstagram = jobs.some((j) => j.platform === 'instagram' && j.status === 'scheduled' && j.scheduled_for);
  const cronMissing = hasScheduledInstagram && !process.env.CRON_SECRET;

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader title="Publish" description="Write once, choose where it goes, and approve each post yourself. PBOS posts only what you approve, and it will not retry a post whose result is unclear." />

      {!connected.youtube && !connected.instagram ? (
        <Alert variant="info" title="Connect a platform to start" className="mb-6">
          Publishing needs YouTube or Instagram connected. <Link href="/connections" className="underline">Open Connections</Link>.
        </Alert>
      ) : null}
      {cronMissing ? <Alert variant="warning" title="Scheduled Instagram posts need the scheduled job" className="mb-6">CRON_SECRET is not set on this deployment, so scheduled Instagram posts cannot go out on time. See docs/INTEGRATIONS.md.</Alert> : null}

      <Section title="New post" description="Saves drafts only. Nothing is sent until you approve a draft.">
        <div className="rounded-lg border border-border bg-card p-5">
          <PublishComposer connected={connected} media={media} ideas={(ideasRes.data ?? []) as Array<{ id: string; hook: string | null }>} />
        </div>
      </Section>

      <Section title="Your posts" description="Drafts wait for your approval. Approved posts show their progress here.">
        {jobs.length === 0 ? (
          <EmptyState title="No posts yet" action={<Link href="#main" className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>Write your first post above</Link>}>
            Drafts, approved posts and results will appear here.
          </EmptyState>
        ) : (
          <PublishQueue jobs={jobs} />
        )}
      </Section>
    </>
  );
}
