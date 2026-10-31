'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, Redo2, Scissors, Type, Undo2 } from 'lucide-react';
import { signedVideoUrl } from '@/actions/studio';
import { StudioExport } from '@/components/studio-export';
import { ClipInspector, TextInspector } from '@/components/studio-inspector';
import { StudioLibrary } from '@/components/studio-library';
import { StudioTimeline, type Selection } from '@/components/studio-timeline';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import {
  addClip, addOverlay, ASPECTS, describeFrame, emptyProject, formatTime, moveClip, removeClip, removeOverlay, setAspect, setClipVolume, setFit,
  splitAt, timelineLength, trimClip, updateOverlay, type AspectKey, type Edit, type FitMode, type OverlayPatch, type Project,
} from '@/lib/studio/edl';
import { probeVideo, StudioEngine } from '@/lib/studio/engine';
import { LOCAL_FILE_MAX_BYTES, type LibraryVideo, type SourceMeta } from '@/lib/studio/types';

type History = { past: Project[]; present: Project; future: Project[] };
const HISTORY_DEPTH = 60;
/** Edits with the same key within this window (dragging a slider) count as one step for undo. */
const COALESCE_MS = 900;

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * The Studio: a small, real video editor that runs entirely in the browser. Clips are cut from library videos
 * or local files, laid end to end, given text, and recorded to a file. Nothing is uploaded unless the creator
 * chooses "Save to my library", and the project itself is not stored between visits.
 */
export function StudioEditor({ library }: { library: LibraryVideo[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<StudioEngine | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineProblem, setEngineProblem] = useState<string | null>(null);

  const histRef = useRef<History>({ past: [], present: emptyProject(), future: [] });
  const [hist, setHist] = useState<History>(histRef.current);
  const lastEdit = useRef<{ key: string; at: number }>({ key: '', at: 0 });
  const project = hist.present;

  const [sources, setSources] = useState<Record<string, SourceMeta>>({});
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [loadingLocal, setLoadingLocal] = useState(false);

  const [selection, setSelection] = useState<Selection>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');

  const total = timelineLength(project);
  const urls = useMemo(() => Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, s.url])), [sources]);

  /* ── engine lifecycle ─────────────────────────────────────────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let engine: StudioEngine;
    try { engine = new StudioEngine(canvas); } catch (e) { setEngineProblem(e instanceof Error ? e.message : 'This browser cannot draw video.'); return; }
    let lastPaint = 0;
    engine.onTime = (time) => { const now = performance.now(); if (now - lastPaint > 100) { lastPaint = now; setT(time); } };
    engine.onEnded = () => { setPlaying(false); setT(engine.time); };
    engine.onError = (message) => { setPlaying(false); setProblem(message); };
    engineRef.current = engine;
    setEngineReady(true);
    return () => {
      engine.destroy();
      engineRef.current = null;
      setEngineReady(false);
      // Blob URLs belong to this tab; release them when the editor goes away.
      for (const s of Object.values(sourcesRef.current)) URL.revokeObjectURL(s.url);
    };
  }, []);

  // Hand the engine every change. Re-runs once the engine exists (Strict Mode creates it twice in development).
  useEffect(() => { if (engineReady) engineRef.current?.setProject(project, urls); }, [engineReady, project, urls]);

  // Leaving the page loses the project, so ask first whenever there is something to lose.
  useEffect(() => {
    if (project.clips.length === 0 && !exporting) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [project.clips.length, exporting]);

  /* ── editing with undo ────────────────────────────────────────────── */
  const commit = useCallback((next: History) => { histRef.current = next; setHist(next); }, []);

  const run = useCallback((fn: (p: Project) => Edit, opts?: { key?: string; say?: string }): boolean => {
    const cur = histRef.current;
    const edit = fn(cur.present);
    if (!edit.ok) { setProblem(edit.error); return false; }
    setProblem(null);
    const now = Date.now();
    const merge = !!opts?.key && lastEdit.current.key === opts.key && now - lastEdit.current.at < COALESCE_MS;
    lastEdit.current = { key: opts?.key ?? '', at: now };
    commit({ past: merge ? cur.past : [...cur.past, cur.present].slice(-HISTORY_DEPTH), present: edit.project, future: [] });
    if (edit.selectId) {
      const id = edit.selectId;
      setSelection(edit.project.clips.some((c) => c.id === id) ? { kind: 'clip', id } : edit.project.overlays.some((o) => o.id === id) ? { kind: 'text', id } : null);
    }
    if (opts?.say) setAnnounce(opts.say);
    return true;
  }, [commit]);

  const runPlain = useCallback((fn: (p: Project) => Project, say?: string) => run((p) => ({ ok: true, project: fn(p) }), { say }), [run]);

  function undo() {
    const cur = histRef.current;
    const prev = cur.past[cur.past.length - 1];
    if (!prev) return;
    lastEdit.current = { key: '', at: 0 };
    commit({ past: cur.past.slice(0, -1), present: prev, future: [cur.present, ...cur.future] });
    setAnnounce('Undid the last change.');
  }
  function redo() {
    const cur = histRef.current;
    const next = cur.future[0];
    if (!next) return;
    lastEdit.current = { key: '', at: 0 };
    commit({ past: [...cur.past, cur.present], present: next, future: cur.future.slice(1) });
    setAnnounce('Redid the change.');
  }

  /* ── adding video ─────────────────────────────────────────────────── */
  const addSource = useCallback((key: string, meta: SourceMeta) => {
    setSources((s) => ({ ...s, [key]: meta }));
    sourcesRef.current = { ...sourcesRef.current, [key]: meta };
    // The new source must be known to the engine before the clip is added, which the effect above handles on the next render.
    run((p) => addClip(p, { sourceId: key, label: meta.label, duration: meta.duration }, uid()), { say: `Added ${meta.label} to the timeline.` });
  }, [run]);

  async function addFromLibrary(v: LibraryVideo) {
    setProblem(null);
    const key = `lib:${v.id}`;
    const have = sourcesRef.current[key];
    if (have) { addSource(key, have); return; }
    setLoadingId(v.id);
    try {
      const signed = await signedVideoUrl(v.id);
      if (!signed.ok || !signed.data) { setProblem(signed.ok ? 'Could not open that video.' : signed.error); return; }
      const res = await fetch(signed.data.url);
      if (!res.ok) { setProblem('Could not download that video from your library. Try again.'); return; }
      const blob = await res.blob();
      if (blob.size > LOCAL_FILE_MAX_BYTES) { setProblem('That video is too large to edit in the browser.'); return; }
      const url = URL.createObjectURL(blob);
      try {
        const info = await probeVideo(url);
        addSource(key, { url, label: v.label || 'Library video', duration: info.duration, width: info.width, height: info.height, origin: 'library' });
      } catch (e) {
        URL.revokeObjectURL(url);
        setProblem(e instanceof Error ? e.message : 'This browser could not read that video.');
      }
    } catch {
      setProblem('Could not download that video. Check your connection and try again.');
    } finally {
      setLoadingId(null);
    }
  }

  async function addFromDevice(file: File) {
    setProblem(null);
    if (!file.type.startsWith('video/')) { setProblem(`${file.name} is not a video file.`); return; }
    if (file.size > LOCAL_FILE_MAX_BYTES) { setProblem(`${file.name} is larger than ${Math.round(LOCAL_FILE_MAX_BYTES / 1_048_576)} MB.`); return; }
    setLoadingLocal(true);
    const url = URL.createObjectURL(file);
    try {
      const info = await probeVideo(url);
      addSource(`file:${uid()}`, { url, label: file.name, duration: info.duration, width: info.width, height: info.height, origin: 'local' });
    } catch (e) {
      URL.revokeObjectURL(url);
      setProblem(e instanceof Error ? `${file.name}: ${e.message}` : `${file.name} could not be read by this browser.`);
    } finally {
      setLoadingLocal(false);
    }
  }

  /* ── playback ─────────────────────────────────────────────────────── */
  async function togglePlay() {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.isPlaying) { engine.pause(); setPlaying(false); setT(engine.time); return; }
    setPlaying(true);
    await engine.play();
    if (!engine.isPlaying) setPlaying(false);
  }
  async function seek(time: number) {
    setT(time);
    setPlaying(false);
    await engineRef.current?.seek(time);
  }

  /* ── selection (derived so a removed item can never stay selected) ── */
  const selectedClip = selection?.kind === 'clip' ? project.clips.find((c) => c.id === selection.id) : undefined;
  const selectedClipIndex = selectedClip ? project.clips.indexOf(selectedClip) : -1;
  const selectedText = selection?.kind === 'text' ? project.overlays.find((o) => o.id === selection.id) : undefined;

  const frameLabel = describeFrame(project, Math.round(t * 10) / 10);
  const locked = exporting;

  return (
    <div className="space-y-6">
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>

      {engineProblem ? <Alert variant="destructive" title="The Studio cannot run in this browser">{engineProblem} Try a current version of Chrome, Edge, Firefox or Safari.</Alert> : null}
      {problem ? <Alert variant="destructive">{problem}</Alert> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        {/* Left: picture and controls */}
        <div className="space-y-4">
          <div className="flex justify-center rounded-lg border border-border bg-muted/40 p-3">
            <canvas ref={canvasRef} role="img" aria-label={frameLabel} className="h-auto max-h-[60vh] w-auto max-w-full rounded-md bg-black" />
          </div>

          <fieldset disabled={locked} className="space-y-4">
            <legend className="sr-only">Playback and editing controls</legend>

            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void togglePlay()} disabled={project.clips.length === 0 || !engineReady} aria-label={playing ? 'Pause preview' : 'Play preview'}>
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />} {playing ? 'Pause' : 'Play'}
              </Button>
              <div className="min-w-[10rem] flex-1">
                <label htmlFor="studio-seek" className="sr-only">Playhead position</label>
                <input id="studio-seek" type="range" className="w-full" min={0} max={total || 1} step={0.1} value={Math.min(t, total || 1)} disabled={project.clips.length === 0}
                  aria-valuetext={`${formatTime(t)} of ${formatTime(total)}`} onChange={(e) => void seek(Number(e.target.value))} />
              </div>
              <span className="tabular text-sm text-muted-foreground" aria-hidden="true">{formatTime(t)} / {formatTime(total)}</span>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => run((p) => splitAt(p, t, uid()), { say: 'Split the clip at the playhead.' })} disabled={project.clips.length === 0}><Scissors aria-hidden="true" /> Split at playhead</Button>
              <Button size="sm" variant="outline" onClick={() => run((p) => addOverlay(p, t, uid()), { say: 'Added text at the playhead.' })} disabled={project.clips.length === 0}><Type aria-hidden="true" /> Add text</Button>
              <Button size="sm" variant="outline" onClick={undo} disabled={hist.past.length === 0}><Undo2 aria-hidden="true" /> Undo</Button>
              <Button size="sm" variant="outline" onClick={redo} disabled={hist.future.length === 0}><Redo2 aria-hidden="true" /> Redo</Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Shape</legend>
                {(Object.keys(ASPECTS) as AspectKey[]).map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="studio-aspect" value={k} checked={project.aspect === k} onChange={() => runPlain((p) => setAspect(p, k), `Shape set to ${ASPECTS[k].label}.`)} />
                    <span>{ASPECTS[k].label} <span className="text-muted-foreground">· {ASPECTS[k].hint}</span></span>
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1">
                <label htmlFor="studio-fit" className="text-sm font-medium">When a video is a different shape</label>
                <Select id="studio-fit" className="h-9" value={project.fit} onChange={(e) => runPlain((p) => setFit(p, e.target.value as FitMode), 'Fit changed.')}>
                  <option value="cover">Fill the frame (crops the edges)</option>
                  <option value="contain">Show everything (adds black bars)</option>
                </Select>
              </div>
            </div>
          </fieldset>

          <fieldset disabled={locked}>
            <legend className="sr-only">Timeline</legend>
            <StudioTimeline project={project} selection={selection} onSelect={setSelection} playhead={t} />
          </fieldset>
        </div>

        {/* Right: sources, inspector, export */}
        <div className="space-y-4">
          <StudioLibrary library={library} loadingId={loadingId} disabled={locked || loadingLocal || !engineReady} onAddLibrary={(v) => void addFromLibrary(v)} onAddLocal={(f) => void addFromDevice(f)} />
          {loadingLocal ? <p className="text-sm text-muted-foreground" role="status">Reading your video…</p> : null}

          <fieldset disabled={locked} className="space-y-4">
            <legend className="sr-only">Selected item</legend>
            {selectedClip ? (
              <ClipInspector
                clip={selectedClip}
                index={selectedClipIndex}
                count={project.clips.length}
                playhead={null}
                onTrim={(s, e) => run((p) => trimClip(p, selectedClip.id, s, e), { key: `trim:${selectedClip.id}` })}
                onVolume={(v) => run((p) => setClipVolume(p, selectedClip.id, v), { key: `vol:${selectedClip.id}` })}
                onMove={(dir) => run((p) => moveClip(p, selectedClip.id, dir), { say: dir < 0 ? 'Moved earlier.' : 'Moved later.' })}
                onRemove={() => { if (run((p) => removeClip(p, selectedClip.id), { say: 'Clip removed.' })) setSelection(null); }}
              />
            ) : selectedText ? (
              <TextInspector
                overlay={selectedText}
                total={total}
                onChange={(patch: OverlayPatch) => run((p) => updateOverlay(p, selectedText.id, patch), { key: `text:${selectedText.id}` })}
                onRemove={() => { if (run((p) => removeOverlay(p, selectedText.id), { say: 'Text removed.' })) setSelection(null); }}
              />
            ) : project.clips.length > 0 ? (
              <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground"><Plus className="mr-1 inline size-3.5" aria-hidden="true" />Choose a clip or a piece of text in the timeline to change it.</p>
            ) : null}
          </fieldset>

          <StudioExport project={project} getEngine={() => engineRef.current} onBusyChange={setExporting} />
        </div>
      </div>
    </div>
  );
}
