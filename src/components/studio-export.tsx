'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Film, Upload } from 'lucide-react';
import { registerMedia, requestMediaUpload } from '@/actions/publish';
import { ProgressBar } from '@/components/progress-bar';
import { useToast } from '@/components/toast';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { putWithProgress } from '@/lib/client/upload';
import { exportPlan, formatTime, validateProject, type Project, type Quality } from '@/lib/studio/edl';
import { pickExportFormat, type StudioEngine } from '@/lib/studio/engine';
import { MEDIA_MAX_BYTES } from '@/lib/media-sniff';

type Result = { url: string; blob: Blob; extension: 'mp4' | 'webm'; seconds: number; instagramSafe: boolean; width: number; height: number };

const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Export and save. The export is recorded in the browser at normal speed, so it takes as long as the video and
 * the tab has to stay open. Saving to the library is offered only when the file is H.264 MP4 (what Instagram
 * accepts) and small enough for the library; anything else can still be downloaded.
 */
export function StudioExport({ project, getEngine, onBusyChange }: { project: Project; getEngine: () => StudioEngine | null; onBusyChange: (busy: boolean) => void }) {
  const toast = useToast();
  const [quality, setQuality] = useState<Quality>('720p');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [pct, setPct] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultUrl = useRef<string | null>(null);

  // Browser-only checks run after mount so the server-rendered page matches the first client render.
  const [format, setFormat] = useState<ReturnType<typeof pickExportFormat>>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => { setFormat(pickExportFormat()); setChecked(true); }, []);

  useEffect(() => () => { abort.current?.abort(); if (resultUrl.current) URL.revokeObjectURL(resultUrl.current); }, []);

  const plan = exportPlan(project, quality);
  const issues = validateProject(project);
  const busy = phase !== 'idle';

  function drop() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setSaved(false);
  }

  async function start() {
    const engine = getEngine();
    if (!engine || !format || issues.length > 0) return;
    drop();
    setProblem(null);
    setPct(0);
    setPhase('recording');
    onBusyChange(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const out = await engine.exportVideo(plan, format, { onProgress: (f) => setPct(f * 100), signal: controller.signal });
      const url = URL.createObjectURL(out.blob);
      resultUrl.current = url;
      setResult({ url, blob: out.blob, extension: out.extension, seconds: out.seconds, instagramSafe: format.instagramSafe, width: plan.width, height: plan.height });
      toast.push('success', 'Your video is ready.');
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message !== 'cancelled') setProblem(message || 'The export failed. Try again, or lower the quality.');
    } finally {
      abort.current = null;
      setPhase('idle');
      onBusyChange(false);
    }
  }

  async function saveToLibrary() {
    if (!result) return;
    if (result.blob.size > MEDIA_MAX_BYTES) { setProblem(`The file is ${mb(result.blob.size)}, over the ${Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB library limit. Download it instead, or export at 720p.`); return; }
    setProblem(null);
    setPhase('saving');
    setPct(0);
    try {
      const asked = await requestMediaUpload({ mime: 'video/mp4', bytes: result.blob.size });
      if (!asked.ok || !asked.data) { setProblem(asked.ok ? 'Could not prepare the upload.' : asked.error); return; }
      const sent = await putWithProgress(asked.data.uploadUrl, result.blob, setPct);
      if (!sent) { setProblem('The upload failed. Check your connection and try again.'); return; }
      const reg = await registerMedia({ path: asked.data.path, label: `Studio export ${new Date().toISOString().slice(0, 10)}`, width: result.width, height: result.height, duration: result.seconds });
      if (!reg.ok) { setProblem(reg.error); return; }
      setSaved(true);
      toast.push('success', 'Saved to your library.');
    } finally {
      setPhase('idle');
    }
  }

  const canSave = !!result && result.extension === 'mp4' && result.instagramSafe && plan.fitsLibrary && !saved;
  const downloadName = `pbos-edit-${new Date().toISOString().slice(0, 10)}.${result?.extension ?? 'mp4'}`;

  return (
    <section aria-labelledby="studio-export-h" className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 id="studio-export-h" className="font-serif text-lg">Export</h2>

      {checked && !format ? (
        <Alert variant="destructive" title="This browser cannot record video">Open the Studio in a current version of Chrome, Edge, Firefox or Safari to export. Editing and preview still work here.</Alert>
      ) : null}

      <div className="space-y-1">
        <label htmlFor="studio-quality" className="text-sm font-medium">Quality</label>
        <Select id="studio-quality" className="h-9 max-w-xs" value={quality} onChange={(e) => setQuality(e.target.value as Quality)} disabled={busy}>
          <option value="720p">720p (smaller file)</option>
          <option value="1080p">1080p (sharper, larger file)</option>
        </Select>
        <p className="tabular text-xs text-muted-foreground">
          {plan.seconds > 0 ? `${plan.width}×${plan.height}, ${formatTime(plan.seconds)} long, about ${mb(plan.estimatedBytes)}.` : 'Add a clip to see the size.'}
        </p>
      </div>

      {format ? (
        <p className="text-xs text-muted-foreground">
          {format.extension === 'mp4' && format.instagramSafe
            ? 'This browser records H.264 MP4, which Instagram and YouTube both accept.'
            : format.extension === 'mp4'
              ? 'This browser records MP4, but cannot promise the H.264 video Instagram requires, so saving to your library is turned off. You can still download it.'
              : 'This browser records WebM, not MP4. You can download it, but Instagram will not accept it and it cannot be saved to your library. Chrome or Edge record MP4.'}
        </p>
      ) : null}

      {issues.length > 0 ? <Alert variant="warning" title="Fix this before exporting">{issues.join(' ')}</Alert> : null}
      <p className="text-xs text-muted-foreground">The video is recorded at normal speed, so a 30-second edit takes about 30 seconds. Keep this tab open and in front while it runs.</p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void start()} disabled={busy || !format || plan.seconds <= 0 || issues.length > 0}><Film aria-hidden="true" /> {phase === 'recording' ? 'Recording…' : 'Export video'}</Button>
        {phase === 'recording' ? <Button variant="outline" onClick={() => abort.current?.abort()}>Cancel export</Button> : null}
      </div>

      {busy ? <ProgressBar percent={pct} label={phase === 'recording' ? 'Recording your edit' : 'Saving to your library'} /> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}

      {result ? (
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Your finished video ({mb(result.blob.size)})</h3>
          {/* The exported file is the creator's own; captions are not applicable because the editor adds none beyond burned-in text. */}
          <video src={result.url} controls playsInline className="max-h-[50vh] max-w-full rounded-md bg-black" aria-label="Preview of the exported video" />
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline"><a href={result.url} download={downloadName}><Download aria-hidden="true" /> Download</a></Button>
            {canSave ? <Button variant="outline" onClick={() => void saveToLibrary()} disabled={busy}><Upload aria-hidden="true" /> Save to my library</Button> : null}
          </div>
          {saved ? <Alert variant="success">Saved. It is in your library and can be used in the Publish page.</Alert> : null}
          {!canSave && !saved ? <p className="text-xs text-muted-foreground">{!plan.fitsLibrary ? `Saving to the library needs an edit under ${formatTime(180)} and ${Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB. Download this one instead.` : 'Saving to the library is turned off for this file type. Download it instead.'}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
