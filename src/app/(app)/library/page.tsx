import type { Metadata } from 'next';
import { EmptyState } from '@/components/empty-state';
import { ImageGenerator } from '@/components/image-generator';
import { MediaGrid, type LibraryItem } from '@/components/media-grid';
import { MediaUploader } from '@/components/media-uploader';
import { PageHeader, Section } from '@/components/page-header';
import { requireCreator } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';

export const metadata: Metadata = { title: 'Library' };
export const dynamic = 'force-dynamic';
// Generating an image can take close to a minute.
export const maxDuration = 120;

export default async function LibraryPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;
  const day = new Date().toISOString().slice(0, 10);

  const [mediaRes, usageRes] = await Promise.all([
    supabase.from('media_assets').select('id, kind, source, bucket, storage_path, mime_type, bytes, width, height, label, ai_generated, created_at').eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(60),
    supabase.from('api_usage').select('units').eq('creator_id', profile.id).eq('provider', 'image').eq('bucket', 'generate').eq('day', day).maybeSingle(),
  ]);
  if (mediaRes.error) throw new Error(`library: ${mediaRes.error.message}`);
  if (usageRes.error) throw new Error(`library usage: ${usageRes.error.message}`);

  const rows = (mediaRes.data ?? []) as unknown as Array<Omit<LibraryItem, 'previewUrl'> & { bucket: string; storage_path: string }>;
  const admin = createAdminClient();
  const previews = new Map<string, string>();
  if (admin) {
    // Short-lived signed links (10 minutes), created on the server. The bucket itself stays private.
    await Promise.all(rows.slice(0, 30).map(async (m) => {
      const signed = await admin.storage.from(m.bucket).createSignedUrl(m.storage_path, 600);
      if (signed.data?.signedUrl) previews.set(m.id, signed.data.signedUrl);
    }));
  }
  const items: LibraryItem[] = rows.map(({ bucket: _b, storage_path: _p, ...m }) => ({ ...m, previewUrl: previews.get(m.id) ?? null }));
  const limit = Number.parseInt(process.env.IMAGE_DAILY_LIMIT ?? '', 10);
  const dailyLimit = Number.isFinite(limit) && limit > 0 && limit <= 500 ? limit : 10;

  return (
    <>
      <PageHeader title="Library" description="Your images and videos, private to you. Create an image from a description or upload your own, then attach it to a post on the Publish page." />

      <Section title="Create an image" description="AI-generated images are labelled as such everywhere in PBOS.">
        <div className="rounded-lg border border-border bg-card p-5">
          <ImageGenerator configured={Boolean(process.env.OPENAI_API_KEY) && Boolean(admin)} dailyLimit={dailyLimit} usedToday={(usageRes.data as { units: number } | null)?.units ?? 0} />
        </div>
      </Section>

      <Section title="Upload" description="JPEG, PNG or WebP images and MP4 or MOV video, up to 50 MB. Instagram photos must be JPEG.">
        <MediaUploader />
      </Section>

      <Section title="Your files">
        {items.length === 0 ? <EmptyState title="Your library is empty">Generate an image above or upload a file.</EmptyState> : <MediaGrid items={items} />}
      </Section>
    </>
  );
}
