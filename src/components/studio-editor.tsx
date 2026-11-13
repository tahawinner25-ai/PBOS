'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Plus, Redo2, Scissors, Type, Undo2 } from 'lucide-react';
import { signedVideoUrl } from '@/actions/studio';
import { StudioExport } from '@/components/studio-export';
import { buildStudioSave, clearStudio, loadStudio, saveStudio, type StoredSource } from '@/lib/studio/store';
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
import { LOCAL_FILE_MAX_BYTES, type LibraryVideo, type SourceMeta, type StudioPlan } from '@/lib/studio/types';

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
export function StudioEditor({ owner, library, initialPlan = null, planRequested = false }: { owner: string; library: LibraryVideo[]; initialPlan?: StudioPlan | null; planRequested?: boolean }) {
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
  const [planBusy, setPlanBusy] = useState(false);
  const [planLoaded, setPlanLoaded] = useState(false);
  // Work is kept in this browser until the finished edit is downloaded or saved, or the creator starts over.
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'failed'>('idle');
  const restoreDone = useRef(false);

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

  // Bring back the saved edit (timeline and videos) once, after the engine exists.
  useEffect(() => {
    if (restoreDone.current) return;
    restoreDone.current = true;
    let cancelled = false;
    void loadStudio(owner).then((saved) => {
      if (cancelled || !saved || histRef.current.present.clips.length > 0) return;
      const metas: Record<string, SourceMeta> = {};
      for (const [key, s] of Object.entries(saved.sources)) metas[key] = { url: URL.createObjectURL(s.blob), label: s.label, duration: s.duration, width: s.width, height: s.height, origin: s.origin, blob: s.blob };
      sourcesRef.current = { ...sourcesRef.current, ...metas };
      setSources((cur) => ({ ...cur, ...metas }));
      commit({ past: [], present: saved.project, future: [] });
      setRestoredAt(saved.savedAt);
    });
    return () => { cancelled = true; restoreDone.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; commit and owner do not change
  }, []);

  // Save a moment after every change. An empty timeline clears the save.
  useEffect(() => {
    if (!restoreDone.current) return;
    const handle = window.setTimeout(() => {
      if (project.clips.length === 0) { void clearStudio(owner); setSaveState('idle'); return; }
      const stored: Record<string, StoredSource> = {};
      for (const [k, s] of Object.entries(sourcesRef.current)) stored[k] = { label: s.label, origin: s.origin, duration: s.duration, width: s.width, height: s.height, blob: s.blob };
      void saveStudio(owner, buildStudioSave(project, stored)).then((ok) => setSaveState(ok ? 'saved' : 'failed'));
    }, 800);
    return () => window.clearTimeout(handle);
  }, [project, sources, owner]);

  /** The finished edit has been downloaded or saved to the library: the working copy in this browser is no longer needed. */
  const finished = useCallback(() => { void clearStudio(owner); setSaveState('idle'); }, [owner]);

  function startOver() {
    if (!window.confirm('Start over? This removes the timeline and the videos saved in this browser. Nothing in your library is deleted.')) return;
    engineRef.current?.pause();
    for (const s of Object.values(sourcesRef.current)) URL.revokeObjectURL(s.url);
    sourcesRef.current = {};
    setSources({});
    commit({ past: [], present: emptyProject(), future: [] });
    setSelection(null);
    setRestoredAt(null);
    setPlanLoaded(false);
    void clearStudio(owner);
    setSaveState('idle');
    setAnnounce('Started over.');
  }

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

  /** Downloads one library video into this tab and reads its length. Reports its own problems and returns null on failure. */
  async function fetchLibrarySource(v: LibraryVideo): Promise<SourceMeta | null> {
    try {
      const signed = await signedVideoUrl(v.id);
      if (!signed.ok || !signed.data) { setProblem(signed.ok ? 'Could not open that video.' : signed.error); return null; }
      const res = await fetch(signed.data.url);
      if (!res.ok) { setProblem('Could not download that video from your library. Try again.'); return null; }
      const blob = await res.blob();
      if (blob.size > LOCAL_FILE_MAX_BYTES) { setProblem('That video is too large to edit in the browser.'); return null; }
      const url = URL.createObjectURL(blob);
      try {
        const info = await probeVideo(url);
        return { url, label: v.label || 'Library video', duration: info.duration, width: info.width, height: info.height, origin: 'library', blob };
      } catch (e) {
        URL.revokeObjectURL(url);
        setProblem(e instanceof Error ? e.message : 'This browser could not read that video.');
        return null;
      }
    } catch {
      setProblem('Could not download that video. Check your connection and try again.');
      return null;
    }
  }

  async function addFromLibrary(v: LibraryVideo) {
    setProblem(null);
    const key = `lib:${v.id}`;
    const have = sourcesRef.current[key];
    if (have) { addSource(key, have); return; }
    setLoadingId(v.id);
    try {
      const meta = await fetchLibrarySource(v);
      if (meta) addSource(key, meta);
    } finally {
      setLoadingId(null);
    }
  }

  /** Builds the agent's edit with the same editing functions a person uses, as ONE undoable step. Nothing is exported. */
  async function loadAgentEdit() {
    const plan = initialPlan;
    if (!plan || planBusy) return;
    setProblem(null);
    setPlanBusy(true);
    try {
      const metas: Record<string, SourceMeta> = {};
      for (const c of plan.clips) {
        const key = `lib:${c.video.id}`;
        if (metas[key]) continue;
        const meta = sourcesRef.current[key] ?? (await fetchLibrarySource(c.video));
        if (!meta) return;
        metas[key] = meta;
      }
      let p: Project = setFit(setAspect(emptyProject(), plan.aspect), plan.fit);
      for (const c of plan.clips) {
        const key = `lib:${c.video.id}`;
        const meta = metas[key];
        const added = addClip(p, { sourceId: key, label: meta.label, duration: meta.duration }, uid());
        if (!added.ok) { setProblem(added.error); return; }
        p = added.project;
        const clipId = added.selectId as string;
        const trimmed = trimClip(p, clipId, c.start, Math.min(c.end, meta.duration));
        if (!trimmed.ok) { setProblem(`${meta.label}: ${trimmed.error}`); return; }
        p = trimmed.project;
        const vol = setClipVolume(p, clipId, c.volume);
        if (vol.ok) p = vol.project;
      }
      for (const t of plan.texts) {
        const added = addOverlay(p, t.start, uid(), t.text);
        if (!added.ok) { setProblem(added.error); return; }
        const styled = updateOverlay(added.project, added.selectId as string, { start: t.start, end: t.end, position: t.position, size: t.size, color: t.color, box: t.box });
        // A caption that no longer fits (a trim was shortened to the real video length) is left out, not forced in.
        if (styled.ok) p = styled.project;
        else { const dropped = removeOverlay(added.project, added.selectId as string); p = dropped.ok ? dropped.project : added.project; }
      }
      setSources((cur) => ({ ...cur, ...metas }));
      sourcesRef.current = { ...sourcesRef.current, ...metas };
      const cur = histRef.current;
      commit({ past: [...cur.past, cur.present].slice(-HISTORY_DEPTH), present: p, future: [] });
      setSelection(null);
      setPlanLoaded(true);
      setAnnounce('Loaded the edit your agent planned.');
    } finally {
      setPlanBusy(false);
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
      addSource(`file:${uid()}`, { url, label: file.name, duration: info.duration, width: info.width, height: info.height, origin: 'local', blob: file });
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

      {planRequested && !initialPlan ? <Alert variant="warning" title="That plan is not available">The agent’s edit plan could not be found, or none of its videos are in your library any more. You can ask the agent again.</Alert> : null}
      {initialPlan && !planLoaded ? (
        <Alert variant="info" title="Your agent planned an edit">
          {initialPlan.clips.length} clip{initialPlan.clips.length === 1 ? '' : 's'}{initialPlan.texts.length ? `, ${initialPlan.texts.length} caption${initialPlan.texts.length === 1 ? '' : 's'}` : ''}. Nothing is cut or exported yet. Loading it downloads those videos from your library into this tab, and you can change anything before you press Export.
          {initialPlan.skipped > 0 ? ` ${initialPlan.skipped} clip${initialPlan.skipped === 1 ? ' was' : 's were'} left out because the video is no longer in your library.` : ''}
          {project.clips.length > 0 ? ' This replaces what is on your timeline now (you can undo it).' : ''}
          <div className="mt-3"><Button size="sm" onClick={() => void loadAgentEdit()} disabled={planBusy || !engineReady || exporting}>{planBusy ? 'Loading your videos…' : 'Load the agent’s edit'}</Button></div>
        </Alert>
      ) : null}
      {restoredAt !== null && project.clips.length > 0 ? <Alert variant="info" title="Your edit was kept">We brought back your timeline and videos from this browser. They stay saved here until you download or save the finished video, or start over.</Alert> : null}
      {saveState === 'failed' ? <Alert variant="warning" title="Could not keep your edit in this browser">The browser refused to store it (it may be out of space). Your edit still works, but leaving this page will lose it. Export or download before you leave.</Alert> : null}
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
              <Button size="sm" variant="outline" onClick={startOver} disabled={project.clips.length === 0 || exporting}>Start over</Button>
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

          <StudioExport project={project} getEngine={() => engineRef.current} onBusyChange={setExporting} onDelivered={finished} />
        </div>
      </div>
    </div>
  );
}
