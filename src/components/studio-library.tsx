'use client';

import { useRef } from 'react';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/lib/studio/edl';
import { LOCAL_FILE_MAX_BYTES, type LibraryVideo } from '@/lib/studio/types';

const mb = (bytes: number | null) => (bytes ? `${(bytes / 1_048_576).toFixed(1)} MB` : 'size unknown');

/** Where clips come from: videos already in the creator's library, or a file picked from this device. */
export function StudioLibrary({ library, loadingId, disabled, onAddLibrary, onAddLocal }: {
  library: LibraryVideo[]; loadingId: string | null; disabled: boolean; onAddLibrary: (v: LibraryVideo) => void; onAddLocal: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby="studio-sources-h" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <h2 id="studio-sources-h" className="font-serif text-lg">Add video</h2>

      <div className="space-y-2">
        <input
          ref={input}
          id="studio-local-file"
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a video file from this device"
          accept="video/mp4,video/quicktime,video/webm"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onAddLocal(f); e.target.value = ''; }}
          disabled={disabled}
          aria-describedby="studio-local-hint"
        />
        <Button variant="outline" onClick={() => input.current?.click()} disabled={disabled}><Upload aria-hidden="true" /> Choose a file from this device</Button>
        <p id="studio-local-hint" className="text-xs text-muted-foreground">MP4, MOV or WebM, up to {Math.round(LOCAL_FILE_MAX_BYTES / 1_048_576)} MB. It stays on this device while you edit; nothing is uploaded until you choose to save the result.</p>
      </div>

      <div>
        <h3 className="text-sm font-medium">From your library</h3>
        {library.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">No videos in your library yet. Upload one on the Library page, or pick a file from this device above.</p>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {library.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" title={v.label ?? undefined}>{v.label || 'Untitled video'}</p>
                  <p className="text-xs text-muted-foreground">{v.duration ? formatTime(v.duration) : 'length unknown'} · {mb(v.bytes)}</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => onAddLibrary(v)} disabled={disabled || loadingId !== null} aria-label={`Add ${v.label || 'untitled video'} to the timeline`}>
                  <Plus aria-hidden="true" /> {loadingId === v.id ? 'Loading…' : 'Add'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
