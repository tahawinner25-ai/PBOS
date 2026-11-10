'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, Film, ImagePlus, Music, Pause, Play, Plus, RotateCcw, Sparkles, Trash2, Upload } from 'lucide-react';
import { registerMedia, requestMediaUpload } from '@/actions/publish';
import { makeScenePicture, planVideo } from '@/actions/video';
import { ActionForm, Field, SubmitButton } from '@/components/action-form';
import { ProgressBar } from '@/components/progress-bar';
import { useToast } from '@/components/toast';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { putWithProgress } from '@/lib/client/upload';
import { MEDIA_MAX_BYTES } from '@/lib/media-sniff';
import { DEFAULT_SOUND, MOOD_INFO, MUSIC_MOODS, OWN_AUDIO_MAX_BYTES, hasSound, isMood, type MusicMood, type SoundSettings } from '@/lib/storyboard/audio';
import { MOTIONS, MOTION_LABELS, SHAPES, STORYBOARD, STYLES, blankScene, isMotion, storyboardIssues, totalSeconds, type Scene, type StyleKey } from '@/lib/storyboard/plan';
import { StoryboardPlayer, estimatedBytes, type ScenePicture } from '@/lib/storyboard/render';
import type { VideoPlan } from '@/lib/agent/handoff';
import { formatTime, type AspectKey } from '@/lib/studio/edl';
import { pickExportFormat } from '@/lib/studio/engine';
import { buildDraft, clearDraft, hasWork, loadDraft, saveDraft, PICTURE_MAX_BYTES } from '@/lib/storyboard/store';

type Pic = { url: string; blob: Blob; width: number; height: number; origin: 'free' | 'upload' };
type Own = { name: string; blob: Blob; buffer: AudioBuffer | null; seconds: number };
type Result = { url: string; blob: Blob; extension: 'mp4' | 'webm'; seconds: number; instagramSafe: boolean; width: number; height: number; hasSound: boolean };

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `s${Date.now()}${Math.random().toString(16).slice(2)}`);
const mb = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const UPLOAD_MAX = PICTURE_MAX_BYTES;

/** Turns the base64 picture the server sends back into a Blob, without a network request (the page's rules do not allow fetching data: URLs). */
function blobFromDataUrl(dataUrl: string): Blob | null {
  const m = /^data:(image\/jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

function loadPicture(url: string): Promise<ScenePicture> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ source: img, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('That picture could not be read.'));
    img.src = url;
  });
}

/**
 * Storyboard videos, made entirely in the browser: AI drafts the scenes, a free service draws one picture per scene (or
 * you upload your own), and the browser animates and records the video. Nothing is posted from here; the finished
 * file can be downloaded or saved to the library, and posting still goes through Publish and its approval step.
 */
export function StoryboardVideo({ owner, aiReady, picturesReady, dailyLimit, usedToday, initialTopic = '', initialPlan = null, planRequested = false }: { owner: string; aiReady: boolean; picturesReady: boolean; dailyLimit: number; usedToday: number; initialTopic?: string; /** A storyboard the agent prepared (checked on the server). */ initialPlan?: VideoPlan | null; planRequested?: boolean }) {
  const toast = useToast();
  const [shape, setShape] = useState<AspectKey>('9:16');
  const [style, setStyle] = useState<StyleKey>('photo');
  const [topic, setTopic] = useState(initialTopic);
  const [title, setTitle] = useState('');
  const [sound, setSound] = useState<SoundSettings>(DEFAULT_SOUND);
  const [own, setOwn] = useState<Own | null>(null);
  const [soundProblem, setSoundProblem] = useState<string | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  // A plan from the agent. It never replaces unfinished work on its own: it is offered, and the creator chooses.
  const [offer, setOffer] = useState<VideoPlan | null>(null);
  const [fromAgent, setFromAgent] = useState(false);
  const [ready, setReady] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [pics, setPics] = useState<Record<string, Pic>>({});
  const [loaded, setLoaded] = useState<Map<string, ScenePicture>>(new Map());
  const [used, setUsed] = useState(usedToday);
  const [making, setMaking] = useState<string | null>(null);
  const [makeNote, setMakeNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const stopMaking = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const player = useRef<StoryboardPlayer | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [quality, setQuality] = useState<'720p' | '1080p'>('720p');
  const [phase, setPhase] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [pct, setPct] = useState(0);
  const [exportProblem, setExportProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [saved, setSaved] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const resultUrl = useRef<string | null>(null);
  const picsRef = useRef(pics);
  picsRef.current = pics;

  // Browser-only checks run after mount so the server render matches the first client render.
  const [format, setFormat] = useState<ReturnType<typeof pickExportFormat>>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => { setFormat(pickExportFormat()); setChecked(true); }, []);

  const total = totalSeconds(scenes);
  const issues = storyboardIssues(scenes, (id) => Boolean(pics[id]));
  const busy = phase !== 'idle';
  const left = Math.max(0, dailyLimit - used);

  /* ── the player ── */
  useEffect(() => {
    if (!canvasRef.current) return;
    const p = new StoryboardPlayer(canvasRef.current);
    p.onTime = setTime;
    p.onEnded = () => setPlaying(false);
    player.current = p;
    return () => { p.destroy(); player.current = null; };
  }, []);
  useEffect(() => { player.current?.setStoryboard(scenes, loaded, shape); }, [scenes, loaded, shape]);
  useEffect(() => { player.current?.setSound(sound, own?.buffer ?? null); }, [sound, own]);

  // Decode each picture once, when it first appears. A picture that fails to decode is not retried in a loop.
  const attempted = useRef(new Set<string>());
  useEffect(() => {
    setLoaded((prev) => {
      const stale = [...prev.keys()].filter((id) => !pics[id]);
      if (stale.length === 0) return prev;
      const next = new Map(prev);
      stale.forEach((id) => next.delete(id));
      return next;
    });
    const todo = Object.entries(pics).filter(([id, pic]) => !attempted.current.has(`${id}|${pic.url}`));
    todo.forEach(([id, pic]) => attempted.current.add(`${id}|${pic.url}`));
    for (const [id, pic] of todo) {
      void loadPicture(pic.url).then((p) => {
        if (picsRef.current[id]?.url !== pic.url) return;
        setLoaded((prev) => new Map(prev).set(id, p));
      }, () => setProblem('One of the pictures could not be read. Make or upload it again.'));
    }
  }, [pics]);

  useEffect(() => () => {
    abort.current?.abort();
    stopMaking.current = true;
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    for (const pic of Object.values(picsRef.current)) URL.revokeObjectURL(pic.url);
  }, []);

  /* ── remembering the work in this browser ── */
  const restoreOnce = useRef(false);
  useEffect(() => {
    if (restoreOnce.current) return;
    restoreOnce.current = true;
    void (async () => {
      const draft = await loadDraft(owner);
      if (draft && hasWork(draft)) {
        const next: Record<string, Pic> = {};
        for (const [id, p] of Object.entries(draft.pictures)) next[id] = { url: URL.createObjectURL(p.blob), blob: p.blob, width: p.width, height: p.height, origin: p.origin };
        setPics(next);
        setScenes(draft.scenes);
        setTitle(draft.title);
        setShape(draft.shape);
        setStyle(draft.style);
        setSound(draft.sound);
        if (!initialTopic) setTopic(draft.topic);
        setRestored(draft.savedAt);
        if (draft.ownAudio) {
          const { name, blob } = draft.ownAudio;
          const decoded = await player.current?.decodeAudio(blob).catch(() => null);
          setOwn({ name, blob, buffer: decoded ?? null, seconds: decoded?.duration ?? 0 });
          if (!decoded) setSoundProblem('Your saved audio file could not be read by this browser. Add it again.');
        }
      }
      if (initialPlan) {
        if (draft && hasWork(draft)) setOffer(initialPlan);
        else adoptPlan(initialPlan);
      }
      setReady(true);
    })();
  }, [owner, initialTopic, initialPlan]);

  // Save a moment after every change. Nothing is saved before the saved draft has been read back.
  useEffect(() => {
    if (!ready || scenes.length === 0) return;
    const timer = setTimeout(() => {
      const pictures: Record<string, { blob: Blob; width: number; height: number; origin: 'free' | 'upload' }> = {};
      for (const [id, p] of Object.entries(pics)) pictures[id] = { blob: p.blob, width: p.width, height: p.height, origin: p.origin };
      const draft = buildDraft({ topic, title, shape, style, scenes, sound, pictures, ownAudio: own ? { name: own.name, blob: own.blob } : null });
      void saveDraft(owner, draft).then((saved) => setSaveNote(saved ? 'Saved in this browser.' : 'Could not save in this browser (storage is blocked or full). Export before you leave.'));
    }, 700);
    return () => clearTimeout(timer);
  }, [ready, owner, topic, title, shape, style, scenes, sound, pics, own]);

  async function startOver() {
    if (!window.confirm('Start over? This clears the scenes, pictures and sound saved in this browser. A finished video you already downloaded is not affected.')) return;
    for (const pic of Object.values(picsRef.current)) URL.revokeObjectURL(pic.url);
    await clearDraft(owner);
    setPics({}); setLoaded(new Map()); setScenes([]); setTitle(''); setTopic(''); setSound(DEFAULT_SOUND); setOwn(null);
    setRestored(null); setSaveNote(null); setProblem(null); setSoundProblem(null); setMakeNote(null);
    dropResult();
  }

  /* ── own audio ── */
  async function addOwnAudio(file: File | undefined) {
    if (!file) return;
    setSoundProblem(null);
    const looksAudio = file.type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|oga|webm)$/i.test(file.name);
    if (!looksAudio) { setSoundProblem('Use an audio file: MP3, WAV, M4A or OGG.'); return; }
    if (file.size > OWN_AUDIO_MAX_BYTES) { setSoundProblem(`Audio files can be up to ${Math.round(OWN_AUDIO_MAX_BYTES / 1_048_576)} MB.`); return; }
    const p = player.current;
    if (!p) return;
    try {
      const buffer = await p.decodeAudio(file);
      setOwn({ name: file.name.slice(0, 120), blob: file, buffer, seconds: buffer.duration });
    } catch (e) {
      setSoundProblem(e instanceof Error ? e.message : 'That audio file could not be read.');
    }
  }

  /* ── scenes ── */
  const patch = useCallback((id: string, change: Partial<Scene>) => setScenes((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s))), []);
  const dropPicture = useCallback((id: string) => {
    setPics((all) => {
      const { [id]: gone, ...rest } = all;
      if (gone) URL.revokeObjectURL(gone.url);
      return rest;
    });
  }, []);

  function addScene() {
    if (scenes.length >= STORYBOARD.maxScenes) { setProblem(`A video can have up to ${STORYBOARD.maxScenes} scenes.`); return; }
    setScenes((all) => [...all, blankScene(newId(), all.length)]);
  }
  function removeScene(id: string) {
    setScenes((all) => all.filter((s) => s.id !== id));
    dropPicture(id);
  }
  function move(id: string, by: -1 | 1) {
    setScenes((all) => {
      const i = all.findIndex((s) => s.id === id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= all.length) return all;
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  /** Loads the agent's storyboard into the editor. Pictures are made here, one per scene, by the creator. */
  function adoptPlan(plan: VideoPlan) {
    startFrom({ title: plan.title, scenes: plan.scenes });
    setTopic(plan.topic);
    setShape(plan.shape);
    setStyle(plan.style);
    setOffer(null);
    setFromAgent(true);
  }

  function startFrom(planned: { title: string; scenes: Array<Omit<Scene, 'id'>> }) {
    for (const pic of Object.values(picsRef.current)) URL.revokeObjectURL(pic.url);
    setPics({});
    setLoaded(new Map());
    setResult(null);
    setSaved(false);
    setTitle(planned.title);
    setScenes(planned.scenes.map((s, i) => ({ ...s, id: newId(), motion: isMotion(s.motion) ? s.motion : MOTIONS[i % MOTIONS.length] })));
    setProblem(null);
  }

  /* ── pictures ── */
  async function makePicture(scene: Scene): Promise<boolean> {
    const form = new FormData();
    form.set('picture', scene.picture);
    form.set('shape', shape);
    form.set('style', style);
    setMaking(scene.id);
    try {
      const res = await makeScenePicture(form);
      setUsed((n) => n + 1);
      if (!res.ok || !res.data) { setProblem(res.ok ? 'No picture came back. Try again.' : res.error); return false; }
      const blob = blobFromDataUrl(res.data.dataUrl);
      if (!blob) { setProblem('The picture that came back was not a usable image. Try again.'); return false; }
      const url = URL.createObjectURL(blob);
      setPics((all) => { if (all[scene.id]) URL.revokeObjectURL(all[scene.id].url); return { ...all, [scene.id]: { url, blob, width: res.data!.width, height: res.data!.height, origin: 'free' } }; });
      return true;
    } catch {
      setProblem('Could not reach the server. Check your connection and try again.');
      return false;
    } finally {
      setMaking(null);
    }
  }

  async function makeOne(scene: Scene) {
    setProblem(null);
    setMakeNote(null);
    await makePicture(scene);
  }

  async function makeAll() {
    setProblem(null);
    stopMaking.current = false;
    const todo = scenes.filter((s) => !picsRef.current[s.id] && s.picture.trim().length >= STORYBOARD.pictureMin);
    if (todo.length === 0) { setProblem('Every scene already has a picture, or is missing its picture description.'); return; }
    for (let i = 0; i < todo.length; i += 1) {
      if (stopMaking.current) break;
      setMakeNote(`Making picture ${i + 1} of ${todo.length}. The free service allows about one picture every 45 seconds, so this can take a few minutes. Keep this tab open.`);
      if (!(await makePicture(todo[i]))) break;
    }
    setMakeNote(null);
  }

  function upload(scene: Scene, file: File | undefined) {
    if (!file) return;
    if (!UPLOAD_TYPES.includes(file.type)) { setProblem('Use a JPEG, PNG or WebP picture.'); return; }
    if (file.size > UPLOAD_MAX) { setProblem('Pictures can be up to 10 MB.'); return; }
    setProblem(null);
    dropPicture(scene.id);
    const url = URL.createObjectURL(file);
    void loadPicture(url).then((p) => setPics((all) => ({ ...all, [scene.id]: { url, blob: file, width: p.width, height: p.height, origin: 'upload' } })), () => { URL.revokeObjectURL(url); setProblem('That picture could not be read.'); });
  }

  /* ── export ── */
  function dropResult() {
    if (resultUrl.current) URL.revokeObjectURL(resultUrl.current);
    resultUrl.current = null;
    setResult(null);
    setSaved(false);
  }

  async function exportVideo() {
    const p = player.current;
    if (!p || !format || issues.length > 0) return;
    dropResult();
    setExportProblem(null);
    setPct(0);
    setPlaying(false);
    setPhase('recording');
    const controller = new AbortController();
    abort.current = controller;
    try {
      const out = await p.exportVideo(quality, { onProgress: (f) => setPct(f * 100), signal: controller.signal, format });
      const url = URL.createObjectURL(out.blob);
      resultUrl.current = url;
      setResult({ url, blob: out.blob, extension: out.extension, seconds: out.seconds, instagramSafe: out.instagramSafe, width: out.width, height: out.height, hasSound: out.hasSound });
      toast.push('success', 'Your video is ready.');
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message !== 'cancelled') setExportProblem(message || 'The export failed. Try again, or lower the quality.');
    } finally {
      abort.current = null;
      setPhase('idle');
    }
  }

  async function saveToLibrary() {
    if (!result) return;
    if (result.blob.size > MEDIA_MAX_BYTES) { setExportProblem(`The file is ${mb(result.blob.size)}, over the ${Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB library limit. Download it instead, or export at 720p.`); return; }
    setExportProblem(null);
    setPhase('saving');
    setPct(0);
    try {
      const asked = await requestMediaUpload({ mime: 'video/mp4', bytes: result.blob.size });
      if (!asked.ok || !asked.data) { setExportProblem(asked.ok ? 'Could not prepare the upload.' : asked.error); return; }
      if (!(await putWithProgress(asked.data.uploadUrl, result.blob, setPct))) { setExportProblem('The upload failed. Check your connection and try again.'); return; }
      const reg = await registerMedia({ path: asked.data.path, label: `Storyboard video: ${title || 'untitled'}`.slice(0, 80), width: result.width, height: result.height, duration: result.seconds });
      if (!reg.ok) { setExportProblem(reg.error); return; }
      setSaved(true);
      toast.push('success', 'Saved to your library.');
    } finally {
      setPhase('idle');
    }
  }

  const canSave = !!result && result.extension === 'mp4' && result.instagramSafe && !saved && result.blob.size <= MEDIA_MAX_BYTES;
  const downloadName = `pbos-storyboard-${new Date().toISOString().slice(0, 10)}.${result?.extension ?? 'mp4'}`;
  const sceneNow = useMemo(() => {
    let at = 0;
    for (let i = 0; i < scenes.length; i += 1) { if (time >= at && time < at + scenes[i].seconds) return i; at += scenes[i].seconds; }
    return Math.max(0, scenes.length - 1);
  }, [scenes, time]);

  return (
    <div className="space-y-8">
      {planRequested && !initialPlan ? <Alert variant="warning" title="That plan is not available">The agent’s plan could not be found. It may have been withdrawn with Undo. You can ask the agent again or start a new idea below.</Alert> : null}
      {offer ? (
        <Alert variant="info" title="Your agent prepared a video plan">
          “{offer.title}”, {offer.scenes.length} scenes. You have an unfinished video saved in this browser, so the plan was not loaded.{' '}
          <button type="button" onClick={() => adoptPlan(offer)} className="font-medium underline underline-offset-2">Use the agent’s plan instead (replaces your current scenes)</button>
        </Alert>
      ) : null}
      {fromAgent ? <Alert variant="success" title="Your agent’s plan is loaded">The scenes below came from your agent. Nothing is made yet: read and edit them, then make a picture for each scene, choose the sound and export. Nothing is posted from here.</Alert> : null}
      {restored !== null ? (
        <Alert variant="info" title="Welcome back">
          Your unfinished video was restored from this browser{restored > 0 ? ` (saved ${new Date(restored).toLocaleString()})` : ''}. It is kept on this device only.{' '}
          <button type="button" onClick={() => void startOver()} className="inline-flex items-center gap-1 font-medium underline underline-offset-2"><RotateCcw className="size-3.5" aria-hidden="true" /> Start over</button>
        </Alert>
      ) : null}
      <section aria-labelledby="sb-idea-h" className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 id="sb-idea-h" className="font-serif text-lg">1. Your idea</h2>
        <ActionForm action={planVideo} className="space-y-4" toastOnSuccess={false} onSuccess={(r) => { const d = r.data as { title: string; scenes: Array<Omit<Scene, 'id'>> } | undefined; if (d) startFrom(d); }}>
          <Field label="What is the video about?" name="topic" required hint={`Say who it is for and what they should take away. Up to ${STORYBOARD.topicMax} characters. Only figures you write here can appear in captions.`}>
            <Textarea rows={3} maxLength={STORYBOARD.topicMax} value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!aiReady} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Shape" name="shape" hint={SHAPES[shape].hint}>
              <Select value={shape} onChange={(e) => setShape(e.target.value as AspectKey)}>
                {(Object.keys(SHAPES) as AspectKey[]).map((k) => <option key={k} value={k}>{SHAPES[k].label}</option>)}
              </Select>
            </Field>
            <Field label="Scenes" name="scenes" hint="More scenes make a longer video.">
              <Select defaultValue={String(STORYBOARD.defaultScenes)}>
                {Array.from({ length: STORYBOARD.maxScenes - STORYBOARD.minScenes + 1 }, (_, i) => i + STORYBOARD.minScenes).map((n) => <option key={n} value={n}>{n} scenes</option>)}
              </Select>
            </Field>
            <div className="space-y-1.5">
              <label htmlFor="sb-style" className="text-sm font-medium">Look of the pictures</label>
              <Select id="sb-style" value={style} onChange={(e) => setStyle(e.target.value as StyleKey)}>
                {(Object.keys(STYLES) as StyleKey[]).map((k) => <option key={k} value={k}>{STYLES[k].label}</option>)}
              </Select>
            </div>
          </div>
          {!aiReady ? <Alert variant="info" title="AI is not switched on">Writing the storyboard needs an AI key (see Connections). You can still build the video by hand: add scenes below, describe each picture or upload your own.</Alert> : null}
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Writing the storyboard…" disabled={!aiReady}><Sparkles aria-hidden="true" /> Write the storyboard</SubmitButton>
            <Button variant="outline" onClick={() => { if (scenes.length === 0) setScenes([blankScene(newId(), 0), blankScene(newId(), 1), blankScene(newId(), 2)]); }} disabled={scenes.length > 0}>Start with blank scenes</Button>
          </div>
        </ActionForm>
      </section>

      {scenes.length > 0 ? (
        <section aria-labelledby="sb-scenes-h" className="space-y-4 rounded-lg border border-border bg-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <h2 id="sb-scenes-h" className="font-serif text-lg">2. Scenes and pictures</h2>
              <p className="tabular text-xs text-muted-foreground">{scenes.length} scenes, {formatTime(total)} long. {saveNote ?? ''}{picturesReady ? ` ${left} of ${dailyLimit} free pictures left today (failed tries count).` : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void makeAll()} disabled={!picturesReady || making !== null || left === 0}><ImagePlus aria-hidden="true" /> Make all missing pictures</Button>
              {making !== null ? <Button variant="outline" onClick={() => { stopMaking.current = true; }}>Stop after this one</Button> : null}
              <Button variant="ghost" onClick={() => void startOver()} disabled={making !== null || busy}><RotateCcw aria-hidden="true" /> Start over</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="sb-title" className="text-sm font-medium">Working title</label>
            <Input id="sb-title" value={title} maxLength={STORYBOARD.titleMax} onChange={(e) => setTitle(e.target.value)} className="max-w-md" />
          </div>
          {!picturesReady ? <Alert variant="info" title="Free pictures are not switched on">Picture limits need file storage on this deployment (SUPABASE_SERVICE_ROLE_KEY). You can still upload your own pictures for every scene.</Alert> : null}
          {makeNote ? <Alert variant="info">{makeNote}</Alert> : null}
          {problem ? <Alert variant="destructive">{problem}</Alert> : null}

          <ol className="space-y-4">
            {scenes.map((s, i) => {
              const pic = pics[s.id];
              const working = making === s.id;
              return (
                <li key={s.id} className="grid gap-4 rounded-md border border-border p-4 md:grid-cols-[9rem,1fr]">
                  <div className="space-y-2">
                    <div className="flex aspect-square w-36 items-center justify-center overflow-hidden rounded-md bg-muted text-xs text-muted-foreground">
                      {pic ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={pic.url} alt={`Picture for scene ${i + 1}`} className="size-full object-cover" />
                      ) : working ? 'Drawing…' : 'No picture yet'}
                    </div>
                    {pic?.origin === 'free' ? <p className="text-xs text-muted-foreground">AI-generated</p> : null}
                  </div>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-medium">Scene {i + 1}</h3>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" aria-label={`Move scene ${i + 1} up`} onClick={() => move(s.id, -1)} disabled={i === 0}><ArrowUp aria-hidden="true" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Move scene ${i + 1} down`} onClick={() => move(s.id, 1)} disabled={i === scenes.length - 1}><ArrowDown aria-hidden="true" /></Button>
                        <Button size="icon" variant="ghost" aria-label={`Remove scene ${i + 1}`} onClick={() => removeScene(s.id)}><Trash2 aria-hidden="true" /></Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`cap-${s.id}`} className="text-sm font-medium">Caption on screen</label>
                      <Input id={`cap-${s.id}`} value={s.caption} maxLength={STORYBOARD.captionMax} onChange={(e) => patch(s.id, { caption: e.target.value })} />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor={`pic-${s.id}`} className="text-sm font-medium">Describe the picture</label>
                      <Textarea id={`pic-${s.id}`} rows={2} value={s.picture} maxLength={STORYBOARD.pictureMax} onChange={(e) => patch(s.id, { picture: e.target.value })} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label htmlFor={`sec-${s.id}`} className="text-sm font-medium">Seconds</label>
                        <Input id={`sec-${s.id}`} type="number" min={STORYBOARD.minSeconds} max={STORYBOARD.maxSeconds} step={0.5} value={s.seconds} onChange={(e) => patch(s.id, { seconds: Number.parseFloat(e.target.value) || STORYBOARD.defaultSeconds })} />
                      </div>
                      <div className="space-y-1.5">
                        <label htmlFor={`mot-${s.id}`} className="text-sm font-medium">Camera</label>
                        <Select id={`mot-${s.id}`} value={s.motion} onChange={(e) => patch(s.id, { motion: e.target.value as Scene['motion'] })}>
                          {MOTIONS.map((m) => <option key={m} value={m}>{MOTION_LABELS[m]}</option>)}
                        </Select>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => void makeOne(s)} disabled={!picturesReady || making !== null || left === 0 || s.picture.trim().length < STORYBOARD.pictureMin}><ImagePlus aria-hidden="true" /> {pic ? 'Make a new picture' : 'Make picture'}</Button>
                      <Button size="sm" variant="outline" asChild>
                        <label className="cursor-pointer"><Upload aria-hidden="true" /> Use my own picture<input type="file" accept={UPLOAD_TYPES.join(',')} className="sr-only" onChange={(e) => { upload(s, e.target.files?.[0]); e.target.value = ''; }} /></label>
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <Button variant="outline" onClick={addScene} disabled={scenes.length >= STORYBOARD.maxScenes}><Plus aria-hidden="true" /> Add a scene</Button>
        </section>
      ) : null}

      {scenes.length > 0 ? (
        <section aria-labelledby="sb-sound-h" className="space-y-4 rounded-lg border border-border bg-card p-5">
          <h2 id="sb-sound-h" className="font-serif text-lg">3. Sound</h2>
          <p className="text-sm text-muted-foreground">Free, and made in your browser: a short background track, and any audio file you bring. Skip both for a silent video.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="sb-mood" className="text-sm font-medium">Background music</label>
              <Select id="sb-mood" value={sound.mood} onChange={(e) => { if (isMood(e.target.value)) setSound((v) => ({ ...v, mood: e.target.value as MusicMood })); }}>
                {MUSIC_MOODS.map((m) => <option key={m} value={m}>{MOOD_INFO[m].label}</option>)}
              </Select>
              <p className="text-xs text-muted-foreground">{MOOD_INFO[sound.mood].hint} An original track, so there is nothing to license.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="sb-music-vol" className="text-sm font-medium">Music volume</label>
              <input id="sb-music-vol" type="range" min={0} max={100} step={5} value={Math.round(sound.musicVolume * 100)} disabled={sound.mood === 'none'} onChange={(e) => setSound((v) => ({ ...v, musicVolume: Number(e.target.value) / 100 }))} className="w-full" />
              <p className="tabular text-xs text-muted-foreground">{Math.round(sound.musicVolume * 100)}%</p>
            </div>
          </div>
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" asChild>
                <label className="cursor-pointer"><Music aria-hidden="true" /> {own ? 'Replace my audio' : 'Add my own audio'}<input type="file" accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg" className="sr-only" onChange={(e) => { void addOwnAudio(e.target.files?.[0]); e.target.value = ''; }} /></label>
              </Button>
              {own ? <Button size="sm" variant="ghost" onClick={() => { setOwn(null); setSoundProblem(null); }}><Trash2 aria-hidden="true" /> Remove</Button> : null}
            </div>
            <p className="text-xs text-muted-foreground">For a voice-over, record yourself on your phone or computer and add the file here (MP3, WAV, M4A or OGG, up to {Math.round(OWN_AUDIO_MAX_BYTES / 1_048_576)} MB). It starts at the beginning of the video. Free AI voices need an account key, so this is the free way.</p>
            {own ? (
              <div className="space-y-1.5">
                <p className="text-sm"><span className="font-medium">{own.name}</span> <span className="tabular text-muted-foreground">({formatTime(own.seconds)})</span></p>
                {own.seconds > total + 0.5 ? <p className="text-xs text-muted-foreground">It is longer than the video, so the end will be cut off.</p> : null}
                <label htmlFor="sb-own-vol" className="text-sm font-medium">Volume of my audio</label>
                <input id="sb-own-vol" type="range" min={0} max={100} step={5} value={Math.round(sound.ownVolume * 100)} onChange={(e) => setSound((v) => ({ ...v, ownVolume: Number(e.target.value) / 100 }))} className="block w-full max-w-xs" />
              </div>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">Use only audio you made or have the right to use. Music from other people usually needs a licence, and platforms can mute or remove videos that use it without one.</p>
          {soundProblem ? <Alert variant="destructive">{soundProblem}</Alert> : null}
        </section>
      ) : null}

      <section aria-labelledby="sb-preview-h" className="space-y-4 rounded-lg border border-border bg-card p-5">
        <h2 id="sb-preview-h" className="font-serif text-lg">4. Preview and export</h2>
        <div className="flex justify-center rounded-md bg-black/40 p-3">
          <canvas ref={canvasRef} role="img" aria-label={scenes.length ? `Preview at ${formatTime(time)} of ${formatTime(total)}. Scene ${sceneNow + 1} of ${scenes.length}${scenes[sceneNow]?.caption ? `: ${scenes[sceneNow].caption}` : ''}.` : 'Preview is empty. Add scenes to begin.'} className="max-h-[60vh] max-w-full rounded" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={scenes.length === 0 || busy} onClick={() => { const p = player.current; if (!p) return; if (p.isPlaying) { p.pause(); setPlaying(false); } else { p.play(); setPlaying(true); } }}>
            {playing ? <><Pause aria-hidden="true" /> Pause</> : <><Play aria-hidden="true" /> Play preview</>}
          </Button>
          <label htmlFor="sb-scrub" className="sr-only">Position in the video</label>
          <input id="sb-scrub" type="range" min={0} max={Math.max(total, 0.1)} step={0.1} value={Math.min(time, Math.max(total, 0.1))} disabled={scenes.length === 0 || busy} onChange={(e) => { player.current?.seek(Number(e.target.value)); setPlaying(false); }} className="min-w-40 flex-1" />
          <span className="tabular text-xs text-muted-foreground">{formatTime(time)} / {formatTime(total)}</span>
        </div>
        <p className="text-xs text-muted-foreground">The preview needs every scene to have a picture to look right. Scenes without one show a dark frame.{hasSound(sound, Boolean(own?.buffer)) ? ' Press Play preview to hear the sound.' : ''}</p>

        {checked && !format ? <Alert variant="destructive" title="This browser cannot record video">Open this page in a current version of Chrome, Edge, Firefox or Safari on a computer to export. Planning and preview still work here.</Alert> : null}

        <div className="space-y-1">
          <label htmlFor="sb-quality" className="text-sm font-medium">Quality</label>
          <Select id="sb-quality" className="h-9 max-w-xs" value={quality} onChange={(e) => setQuality(e.target.value as '720p' | '1080p')} disabled={busy}>
            <option value="720p">720p (smaller file)</option>
            <option value="1080p">1080p (sharper)</option>
          </Select>
          <p className="tabular text-xs text-muted-foreground">{total > 0 ? `${formatTime(total)} long, about ${mb(estimatedBytes(total))}. ${hasSound(sound, Boolean(own?.buffer)) ? 'With sound.' : 'No sound.'}` : 'Add scenes to see the size.'}</p>
        </div>

        {format ? (
          <p className="text-xs text-muted-foreground">
            {format.extension === 'mp4' && format.instagramSafe
              ? 'This browser records H.264 MP4, which YouTube and Instagram accept.'
              : format.extension === 'mp4'
                ? 'This browser records MP4 but cannot promise the H.264 video Instagram needs, so saving to your library is turned off. You can still download it.'
                : 'This browser records WebM. You can download it and upload it to YouTube, but Instagram will not accept it and it cannot be saved to your library. Chrome or Edge record MP4.'}
          </p>
        ) : null}

        {issues.length > 0 && scenes.length > 0 ? <Alert variant="warning" title="Before you can export">{issues.join(' ')}</Alert> : null}
        <p className="text-xs text-muted-foreground">The video is recorded at normal speed, so a 30-second video takes about 30 seconds. Keep this tab open and in front while it runs, on a computer.</p>

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void exportVideo()} disabled={busy || !format || scenes.length === 0 || issues.length > 0}><Film aria-hidden="true" /> {phase === 'recording' ? 'Recording…' : 'Make the video'}</Button>
          {phase === 'recording' ? <Button variant="outline" onClick={() => abort.current?.abort()}>Cancel</Button> : null}
        </div>
        {busy ? <ProgressBar percent={pct} label={phase === 'recording' ? 'Recording your video' : 'Saving to your library'} /> : null}
        {exportProblem ? <Alert variant="destructive">{exportProblem}</Alert> : null}

        {result ? (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Your finished video ({mb(result.blob.size)})</h3>
            {/* Any sound is background music or the creator's own recording, so there is no transcript to show here. */}
            <video src={result.url} controls playsInline className="max-h-[50vh] max-w-full rounded-md bg-black" aria-label="Preview of the finished video" />
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href={result.url} download={downloadName}><Download aria-hidden="true" /> Download</a></Button>
              {canSave ? <Button variant="outline" onClick={() => void saveToLibrary()} disabled={busy}><Upload aria-hidden="true" /> Save to my library</Button> : null}
            </div>
            {saved ? <Alert variant="success">Saved. It is in your library and can be used on the Posting page.</Alert> : null}
            {!canSave && !saved ? <p className="text-xs text-muted-foreground">Saving to the library needs an MP4 under {Math.round(MEDIA_MAX_BYTES / 1_048_576)} MB. Download this one instead.</p> : null}
            <Alert variant="info" title="Before you post it">Most of the pictures are AI-generated. YouTube and Instagram ask you to say so when a video contains realistic synthetic content, so check their disclosure setting when you post. Posting still goes through the Posting page, and nothing is sent until you approve it.</Alert>
          </div>
        ) : null}
      </section>
    </div>
  );
}
