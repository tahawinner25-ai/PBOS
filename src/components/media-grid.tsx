import Link from 'next/link';
import { deleteMedia } from '@/actions/publish';
import { ActionButton } from '@/components/action-button';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { instagramFeedRatioOk } from '@/lib/images/openai';

export type LibraryItem = {
  id: string; kind: 'image' | 'video'; source: 'upload' | 'generated'; mime_type: string; bytes: number | null; width: number | null; height: number | null;
  label: string | null; ai_generated: boolean; created_at: string; previewUrl: string | null;
};

const mb = (b: number | null) => (b ? `${(b / 1_048_576).toFixed(1)} MB` : '');

export function MediaGrid({ items }: { items: LibraryItem[] }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((m) => {
        const ratioOk = m.kind === 'image' ? instagramFeedRatioOk(m.width, m.height) : null;
        return (
          <li key={m.id} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex aspect-[4/3] items-center justify-center bg-muted">
              {m.previewUrl && m.kind === 'image' ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={m.previewUrl} alt={m.label ?? 'Library image'} className="size-full object-cover" loading="lazy" />
                : m.previewUrl && m.kind === 'video' ? <video src={m.previewUrl} className="size-full object-cover" controls preload="metadata" aria-label={m.label ?? 'Library video'} />
                : <span className="text-sm text-muted-foreground">{m.kind === 'video' ? 'Video' : 'Image'}</span>}
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
              <p className="line-clamp-2 font-medium">{m.label ?? (m.kind === 'video' ? 'Video' : 'Image')}</p>
              <div className="flex flex-wrap gap-1.5">
                {m.ai_generated ? <Badge variant="secondary">AI-generated</Badge> : null}
                <Badge variant="outline">{m.kind === 'video' ? 'Video' : m.mime_type.replace('image/', '').toUpperCase()}</Badge>
                {m.width && m.height ? <Badge variant="outline">{m.width}×{m.height}</Badge> : null}
                {ratioOk === false ? <Badge variant="warning">Too tall or wide for Instagram feed</Badge> : null}
                {m.kind === 'image' && m.mime_type !== 'image/jpeg' ? <Badge variant="warning">Not JPEG: Instagram needs JPEG</Badge> : null}
              </div>
              <p className="text-xs text-muted-foreground">Added {formatDate(m.created_at)}{m.bytes ? ` · ${mb(m.bytes)}` : ''}</p>
              <div className="mt-auto flex items-center gap-2 pt-1">
                <Link href="/publish" className="text-sm underline">Use in a post</Link>
                <ActionButton size="sm" variant="ghost" className="ml-auto" action={deleteMedia.bind(null, m.id)} confirm="Delete this file permanently? It is removed from storage too.">Delete</ActionButton>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
