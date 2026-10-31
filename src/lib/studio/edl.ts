/**
 * The Studio's edit model: clips cut from source videos, laid end to end, with text on top. Pure and
 * immutable (every operation returns a new project or an error message), so the rules are tested without a
 * browser and the UI cannot put the project into a state the exporter cannot render.
 *
 * Times are seconds. A clip's start and end are positions inside its SOURCE video; the timeline is just the
 * clips in order.
 */

export type AspectKey = '9:16' | '1:1' | '16:9';
export type FitMode = 'cover' | 'contain';
export type Quality = '720p' | '1080p';

export type Clip = {
  id: string;
  sourceId: string;
  label: string;
  /** Length of the whole source video. A trim can never go outside it. */
  sourceDuration: number;
  start: number;
  end: number;
  /** 0 is silent, 1 is the original level. */
  volume: number;
};

export const POSITIONS = ['top', 'middle', 'bottom'] as const;
export const SIZES = ['small', 'medium', 'large'] as const;
export const COLORS = ['white', 'yellow', 'black'] as const;

export type Overlay = {
  id: string;
  text: string;
  start: number;
  end: number;
  position: (typeof POSITIONS)[number];
  size: (typeof SIZES)[number];
  color: (typeof COLORS)[number];
  /** A dark (or light, for black text) box behind the text so it stays readable on any picture. */
  box: boolean;
};

export type Project = { aspect: AspectKey; fit: FitMode; clips: Clip[]; overlays: Overlay[] };

export const LIMITS = {
  minClip: 0.3,
  maxClips: 24,
  maxOverlays: 20,
  overlayText: 120,
  /** The export is recorded in real time in the browser, so a very long edit would keep the tab busy for as long. */
  maxSeconds: 300,
  /** Files in the library are capped (see MEDIA_MAX_BYTES). Exports up to this long are sized to fit under it. */
  maxLibrarySeconds: 180,
  libraryBytes: 50 * 1024 * 1024,
} as const;

export const ASPECTS: Record<AspectKey, { label: string; hint: string; ratio: number }> = {
  '9:16': { label: 'Vertical 9:16', hint: 'Reels, Shorts, TikTok', ratio: 9 / 16 },
  '1:1': { label: 'Square 1:1', hint: 'Instagram feed', ratio: 1 },
  '16:9': { label: 'Wide 16:9', hint: 'YouTube video', ratio: 16 / 9 },
};

/** Output size for an aspect at a quality. The short side is 720 or 1080, and both sides are even (video encoders need that). */
export function outputSize(aspect: AspectKey, quality: Quality): { width: number; height: number } {
  const short = quality === '1080p' ? 1080 : 720;
  const r = ASPECTS[aspect].ratio;
  const even = (n: number) => Math.round(n / 2) * 2;
  return r >= 1 ? { width: even(short * r), height: short } : { width: short, height: even(short / r) };
}

export const emptyProject = (): Project => ({ aspect: '9:16', fit: 'cover', clips: [], overlays: [] });

/* ── reading the timeline ──────────────────────────────────────────────── */

export const clipLength = (c: Pick<Clip, 'start' | 'end'>): number => Math.max(0, c.end - c.start);
export const timelineLength = (p: Project): number => p.clips.reduce((n, c) => n + clipLength(c), 0);

/** Where each clip begins on the timeline. */
export function clipOffsets(p: Project): number[] {
  const out: number[] = [];
  let at = 0;
  for (const c of p.clips) { out.push(at); at += clipLength(c); }
  return out;
}

export type Located = { index: number; clip: Clip; offset: number; sourceTime: number };

/** The clip showing at timeline time t, and the moment inside its source. t at or beyond the end maps to the last frame. */
export function locate(p: Project, t: number): Located | null {
  if (p.clips.length === 0) return null;
  const offsets = clipOffsets(p);
  const total = timelineLength(p);
  const at = Math.min(Math.max(0, t), Math.max(0, total - 1e-6));
  for (let i = p.clips.length - 1; i >= 0; i--) {
    if (at >= offsets[i]) return { index: i, clip: p.clips[i], offset: offsets[i], sourceTime: p.clips[i].start + (at - offsets[i]) };
  }
  return { index: 0, clip: p.clips[0], offset: 0, sourceTime: p.clips[0].start };
}

export const activeOverlays = (p: Project, t: number): Overlay[] => p.overlays.filter((o) => t >= o.start && t < o.end);

/* ── editing ───────────────────────────────────────────────────────────── */

export type Edit = { ok: true; project: Project; selectId?: string } | { ok: false; error: string };
const fail = (error: string): Edit => ({ ok: false, error });
const round = (n: number) => Math.round(n * 1000) / 1000;

/** Overlays may not outlive the timeline, and may not be shorter than a moment. Applied after every edit that changes the length. */
function settle(p: Project): Project {
  const total = round(timelineLength(p));
  const overlays = p.overlays
    .map((o) => ({ ...o, start: Math.min(o.start, Math.max(0, total - 0.5)), end: Math.min(o.end, total) }))
    .filter((o) => o.end - o.start >= 0.2 && total > 0);
  return { ...p, overlays };
}

export function addClip(p: Project, source: { sourceId: string; label: string; duration: number }, id: string): Edit {
  if (p.clips.length >= LIMITS.maxClips) return fail(`A project can have up to ${LIMITS.maxClips} clips.`);
  if (!Number.isFinite(source.duration) || source.duration < LIMITS.minClip) return fail('That video is too short or its length could not be read.');
  const clip: Clip = { id, sourceId: source.sourceId, label: source.label.slice(0, 80) || 'Clip', sourceDuration: round(source.duration), start: 0, end: round(source.duration), volume: 1 };
  return { ok: true, project: settle({ ...p, clips: [...p.clips, clip] }), selectId: id };
}

export function removeClip(p: Project, id: string): Edit {
  if (!p.clips.some((c) => c.id === id)) return fail('That clip is not in the project.');
  return { ok: true, project: settle({ ...p, clips: p.clips.filter((c) => c.id !== id) }) };
}

export function moveClip(p: Project, id: string, direction: -1 | 1): Edit {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0) return fail('That clip is not in the project.');
  const j = i + direction;
  if (j < 0 || j >= p.clips.length) return fail(direction < 0 ? 'It is already first.' : 'It is already last.');
  const clips = [...p.clips];
  [clips[i], clips[j]] = [clips[j], clips[i]];
  return { ok: true, project: { ...p, clips } };
}

/** Set a clip's in and out points inside its source. Keeps at least minClip, and never leaves the source. */
export function trimClip(p: Project, id: string, start: number, end: number): Edit {
  const c = p.clips.find((x) => x.id === id);
  if (!c) return fail('That clip is not in the project.');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return fail('Enter a time in seconds.');
  const s = round(Math.max(0, Math.min(start, c.sourceDuration)));
  const e = round(Math.max(0, Math.min(end, c.sourceDuration)));
  if (e - s < LIMITS.minClip) return fail(`A clip must be at least ${LIMITS.minClip} seconds long.`);
  return { ok: true, project: settle({ ...p, clips: p.clips.map((x) => (x.id === id ? { ...x, start: s, end: e } : x)) }) };
}

/** Cut the clip under timeline time t into two. The two halves play back exactly as the original did. */
export function splitAt(p: Project, t: number, newId: string): Edit {
  const at = locate(p, t);
  if (!at) return fail('Add a clip first.');
  if (p.clips.length >= LIMITS.maxClips) return fail(`A project can have up to ${LIMITS.maxClips} clips.`);
  const cut = round(at.sourceTime);
  if (cut - at.clip.start < LIMITS.minClip || at.clip.end - cut < LIMITS.minClip) return fail(`Move the playhead at least ${LIMITS.minClip} seconds away from the edges of a clip to cut it.`);
  const first: Clip = { ...at.clip, end: cut };
  const second: Clip = { ...at.clip, id: newId, start: cut };
  const clips = [...p.clips];
  clips.splice(at.index, 1, first, second);
  return { ok: true, project: { ...p, clips }, selectId: newId };
}

export function setClipVolume(p: Project, id: string, volume: number): Edit {
  if (!p.clips.some((c) => c.id === id)) return fail('That clip is not in the project.');
  if (!Number.isFinite(volume)) return fail('Volume must be a number.');
  const v = Math.min(1, Math.max(0, round(volume)));
  return { ok: true, project: { ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, volume: v } : c)) } };
}

export const setAspect = (p: Project, aspect: AspectKey): Project => ({ ...p, aspect });
export const setFit = (p: Project, fit: FitMode): Project => ({ ...p, fit });

/* ── text ──────────────────────────────────────────────────────────────── */

export function addOverlay(p: Project, at: number, id: string, text = 'Your text'): Edit {
  const total = timelineLength(p);
  if (total <= 0) return fail('Add a clip before adding text.');
  if (p.overlays.length >= LIMITS.maxOverlays) return fail(`A project can have up to ${LIMITS.maxOverlays} text layers.`);
  const start = round(Math.min(Math.max(0, at), Math.max(0, total - 0.5)));
  const end = round(Math.min(total, start + 3));
  const overlay: Overlay = { id, text, start, end, position: 'bottom', size: 'medium', color: 'white', box: true };
  return { ok: true, project: { ...p, overlays: [...p.overlays, overlay] }, selectId: id };
}

export type OverlayPatch = Partial<Omit<Overlay, 'id'>>;

export function updateOverlay(p: Project, id: string, patch: OverlayPatch): Edit {
  const o = p.overlays.find((x) => x.id === id);
  if (!o) return fail('That text is not in the project.');
  const next: Overlay = { ...o, ...patch };
  if (typeof next.text !== 'string' || next.text.length > LIMITS.overlayText) return fail(`Text can be up to ${LIMITS.overlayText} characters.`);
  if (!(POSITIONS as readonly string[]).includes(next.position) || !(SIZES as readonly string[]).includes(next.size) || !(COLORS as readonly string[]).includes(next.color)) return fail('That text style is not available.');
  const total = timelineLength(p);
  if (!Number.isFinite(next.start) || !Number.isFinite(next.end)) return fail('Enter a time in seconds.');
  next.start = round(Math.max(0, Math.min(next.start, total)));
  next.end = round(Math.max(0, Math.min(next.end, total)));
  if (next.end - next.start < 0.2) return fail('Text must show for at least 0.2 seconds.');
  next.box = Boolean(next.box);
  return { ok: true, project: { ...p, overlays: p.overlays.map((x) => (x.id === id ? next : x)) } };
}

export function removeOverlay(p: Project, id: string): Edit {
  if (!p.overlays.some((o) => o.id === id)) return fail('That text is not in the project.');
  return { ok: true, project: { ...p, overlays: p.overlays.filter((o) => o.id !== id) } };
}

/* ── drawing geometry ──────────────────────────────────────────────────── */

export type Rect = { x: number; y: number; w: number; h: number };

/** Where a source picture lands inside the output. 'cover' fills the frame and crops; 'contain' shows all of it with bars. */
export function fitRect(srcW: number, srcH: number, outW: number, outH: number, mode: FitMode): Rect {
  if (!(srcW > 0) || !(srcH > 0)) return { x: 0, y: 0, w: outW, h: outH };
  const scale = mode === 'cover' ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (outW - w) / 2, y: (outH - h) / 2, w, h };
}

/** Text size as a share of the output's short side, so it reads the same in every aspect. */
export const TEXT_SCALE: Record<Overlay['size'], number> = { small: 0.045, medium: 0.065, large: 0.09 };

/* ── checks and export planning ────────────────────────────────────────── */

export function validateProject(p: Project): string[] {
  const problems: string[] = [];
  if (p.clips.length === 0) problems.push('Add at least one clip.');
  if (p.clips.length > LIMITS.maxClips) problems.push(`Use at most ${LIMITS.maxClips} clips.`);
  const total = timelineLength(p);
  if (total > LIMITS.maxSeconds) problems.push(`The edit is ${formatTime(total)} long. Exports are limited to ${formatTime(LIMITS.maxSeconds)} because they are recorded in real time in your browser.`);
  for (const c of p.clips) if (clipLength(c) < LIMITS.minClip || c.start < 0 || c.end > c.sourceDuration + 1e-6) problems.push(`The clip “${c.label}” has an invalid trim.`);
  for (const o of p.overlays) {
    if (!o.text.trim()) problems.push('A text layer is empty. Type something or remove it.');
    if (o.end > total + 1e-6) problems.push('A text layer runs past the end of the video.');
  }
  return Array.from(new Set(problems));
}

export type ExportPlan = { width: number; height: number; fps: number; videoBitsPerSecond: number; audioBitsPerSecond: number; estimatedBytes: number; seconds: number; fitsLibrary: boolean };

/**
 * Picks the encoding settings. The bitrate is lowered for longer edits so the file stays under the library's
 * size cap whenever the edit is short enough to allow a watchable bitrate; otherwise it can only be downloaded.
 */
export function exportPlan(p: Project, quality: Quality): ExportPlan {
  const { width, height } = outputSize(p.aspect, quality);
  const seconds = timelineLength(p);
  const ideal = quality === '1080p' ? 8_000_000 : 5_000_000;
  const audio = 128_000;
  const budgetBits = LIMITS.libraryBytes * 0.9 * 8;
  const fitBitrate = seconds > 0 ? Math.floor(budgetBits / seconds - audio) : ideal;
  const floor = 1_200_000;
  const videoBitsPerSecond = Math.max(floor, Math.min(ideal, fitBitrate));
  const estimatedBytes = Math.round(((videoBitsPerSecond + audio) * seconds) / 8);
  return { width, height, fps: 30, videoBitsPerSecond, audioBitsPerSecond: audio, estimatedBytes, seconds, fitsLibrary: seconds <= LIMITS.maxLibrarySeconds && estimatedBytes <= LIMITS.libraryBytes };
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds * 10) / 10);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** A short spoken description of the preview frame, for the canvas's accessible label. */
export function describeFrame(p: Project, t: number): string {
  const at = locate(p, t);
  if (!at) return 'Preview is empty. Add a clip to begin.';
  const text = activeOverlays(p, t).map((o) => `“${o.text}”`);
  return `Preview at ${formatTime(t)} of ${formatTime(timelineLength(p))}. Clip ${at.index + 1} of ${p.clips.length}: ${at.clip.label}.${text.length ? ` Text on screen: ${text.join(', ')}.` : ''}`;
}
