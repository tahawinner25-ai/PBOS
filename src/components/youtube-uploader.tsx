'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import { ProgressBar } from '@/components/progress-bar';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { uploadYouTubeFile } from '@/lib/publish-client';
import { YOUTUBE_VIDEO_MIME } from '@/lib/integrations/validate';

/** Shown on an APPROVED YouTube post: pick the video, watch it upload in chunks, resume if the connection drops. */
export function YouTubeUploader({ jobId, resumeFrom }: { jobId: string; resumeFrom?: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ phase: 'idle' | 'uploading' | 'done' | 'error'; pct: number; name?: string; error?: string; url?: string | null }>({ phase: 'idle', pct: 0 });

  async function start(file: File | undefined) {
    if (!file) return;
    if (!YOUTUBE_VIDEO_MIME.includes(file.type)) { setState({ phase: 'error', pct: 0, error: 'YouTube accepts MP4, MOV, WebM, MKV and AVI videos.' }); return; }
    abort.current = new AbortController();
    setState({ phase: 'uploading', pct: 0, name: file.name });
    const out = await uploadYouTubeFile({ jobId, file, signal: abort.current.signal, onProgress: (p) => setState({ phase: 'uploading', pct: p.percent, name: file.name }) });
    if (out.ok) setState({ phase: 'done', pct: 100, name: file.name, url: out.videoUrl });
    else setState({ phase: 'error', pct: 0, name: file.name, error: out.error });
    router.refresh();
  }

  if (state.phase === 'done') return <Alert variant="success" title="Uploaded to YouTube.">{state.url ? <a className="underline" href={state.url} target="_blank" rel="noreferrer noopener">Open the video</a> : 'YouTube is processing it.'}</Alert>;

  return (
    <div className="space-y-2">
      <input ref={input} type="file" className="sr-only" accept="video/*" onChange={(e) => void start(e.target.files?.[0])} disabled={state.phase === 'uploading'} aria-label="Video file to upload" />
      {state.phase === 'uploading' ? (
        <>
          <ProgressBar percent={state.pct} label={`Uploading ${state.name ?? 'video'}`} />
          <Button type="button" variant="outline" size="sm" onClick={() => abort.current?.abort()}>Pause</Button>
          <p className="text-xs text-muted-foreground">Keep this tab open. If it stops, choose the same file again and it continues where it left off.</p>
        </>
      ) : (
        <>
          <Button type="button" size="sm" onClick={() => input.current?.click()}><Play aria-hidden="true" /> {resumeFrom ? 'Choose the same file to resume' : 'Choose video and upload'}</Button>
          {state.phase === 'error' ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
        </>
      )}
    </div>
  );
}
