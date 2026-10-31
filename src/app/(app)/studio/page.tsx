import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { StudioEditor } from '@/components/studio-editor';
import { requireCreator } from '@/lib/auth';
import type { LibraryVideo } from '@/lib/studio/types';

export const metadata: Metadata = { title: 'Studio' };
export const dynamic = 'force-dynamic';

export default async function StudioPage() {
  const ctx = await requireCreator();
  if (!ctx) return null;
  const { supabase, profile } = ctx;

  // Only the fields the editor needs. Storage paths never leave the server; the editor asks for a short-lived link per video.
  const res = await supabase
    .from('media_assets')
    .select('id, label, bytes, duration_s, width, height')
    .eq('creator_id', profile.id)
    .eq('kind', 'video')
    .order('created_at', { ascending: false })
    .limit(40);
  if (res.error) throw new Error(`studio: ${res.error.message}`);
  const library: LibraryVideo[] = ((res.data ?? []) as Array<{ id: string; label: string | null; bytes: number | null; duration_s: number | null; width: number | null; height: number | null }>)
    .map((r) => ({ id: r.id, label: r.label, bytes: r.bytes, duration: r.duration_s, width: r.width, height: r.height }));

  return (
    <>
      <PageHeader
        title="Studio"
        description="Cut, join and caption short videos in your browser. Your footage stays on your device while you edit. Only a finished video you choose to save is uploaded."
      />
      <div className="mb-6 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <p><strong className="font-medium text-foreground">What to expect.</strong> Your edit is not saved between visits, so export before you leave. Export is recorded at normal speed: a 30-second video takes about 30 seconds, and the tab must stay open. It does not add music, filters or automatic captions.</p>
      </div>
      <StudioEditor library={library} />
    </>
  );
}
