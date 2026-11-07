/**
 * The storyboard video model: a short list of scenes, each with a picture, a caption and a camera move. Pure and
 * free of browser and server code, so the rules, the timing and the camera geometry are tested without either.
 *
 * Times are seconds. The video is the scenes laid end to end; each scene starts with a short cross-fade from the
 * one before it.
 */
import { collectNumbers, scanText, type Validated } from '../agent/validate';
import { fitRect, type AspectKey, type Rect } from '../studio/edl';
import type { Aspect } from '../images/openai';

export const MOTIONS = ['zoom-in', 'zoom-out', 'pan-left', 'pan-right'] as const;
export type Motion = (typeof MOTIONS)[number];

export const MOTION_LABELS: Record<Motion, string> = { 'zoom-in': 'Slow zoom in', 'zoom-out': 'Slow zoom out', 'pan-left': 'Drift left', 'pan-right': 'Drift right' };

export const STYLES = {
  photo: { label: 'Photo', suffix: 'cinematic photograph, natural light, sharp focus' },
  illustration: { label: 'Flat illustration', suffix: 'clean flat vector illustration, bold shapes, soft colours' },
  render: { label: '3D render', suffix: 'soft 3D render, smooth materials, studio lighting' },
  watercolor: { label: 'Watercolour', suffix: 'loose watercolour painting, paper texture, gentle colours' },
} as const;
export type StyleKey = keyof typeof STYLES;
export const isStyle = (s: unknown): s is StyleKey => typeof s === 'string' && s in STYLES;

export const STORYBOARD = {
  minScenes: 2,
  maxScenes: 8,
  defaultScenes: 5,
  minSeconds: 2,
  maxSeconds: 8,
  defaultSeconds: 4,
  /** Recorded in real time in the browser, and sized to stay under the library's 50 MB cap. */
  maxTotalSeconds: 60,
  captionMax: 120,
  pictureMin: 8,
  pictureMax: 400,
  titleMax: 80,
  topicMin: 8,
  topicMax: 600,
  /** Length of the cross-fade at the start of every scene after the first. */
  fade: 0.5,
  /** The camera never moves more than this much of the picture, so it stays calm. */
  zoomAmount: 0.14,
} as const;

export type Scene = { id: string; caption: string; picture: string; seconds: number; motion: Motion };

/** The three video shapes, and the picture shape that fits each best. */
export const SHAPES: Record<AspectKey, { label: string; hint: string; image: Aspect }> = {
  '9:16': { label: 'Vertical 9:16', hint: 'YouTube Shorts, Reels', image: 'portrait' },
  '1:1': { label: 'Square 1:1', hint: 'Instagram feed', image: 'square' },
  '16:9': { label: 'Wide 16:9', hint: 'YouTube', image: 'landscape' },
};
export const isShape = (s: unknown): s is AspectKey => typeof s === 'string' && s in SHAPES;

const round = (n: number) => Math.round(n * 1000) / 1000;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/* ── timing ────────────────────────────────────────────────────────────── */

export const totalSeconds = (scenes: Pick<Scene, 'seconds'>[]): number => round(scenes.reduce((n, s) => n + s.seconds, 0));

export function sceneOffsets(scenes: Pick<Scene, 'seconds'>[]): number[] {
  const out: number[] = [];
  let at = 0;
  for (const s of scenes) { out.push(at); at += s.seconds; }
  return out;
}

export type Layer = { index: number; /** 0 to 1 */ alpha: number; /** progress through the scene, 0 to 1 */ progress: number };

/**
 * What to draw at time t, bottom layer first. Inside the cross-fade at the start of a scene, the previous scene's
 * last frame stays underneath while the new scene fades in. Outside it there is exactly one layer.
 */
export function layersAt(scenes: Pick<Scene, 'seconds'>[], t: number): Layer[] {
  if (scenes.length === 0) return [];
  const total = totalSeconds(scenes);
  const at = Math.min(Math.max(0, t), Math.max(0, total - 1e-6));
  const offsets = sceneOffsets(scenes);
  let index = 0;
  for (let i = scenes.length - 1; i >= 0; i -= 1) if (at >= offsets[i]) { index = i; break; }
  const inScene = at - offsets[index];
  const progress = Math.min(1, Math.max(0, inScene / scenes[index].seconds));
  const fade = Math.min(STORYBOARD.fade, scenes[index].seconds / 2);
  if (index > 0 && inScene < fade) {
    return [{ index: index - 1, alpha: 1, progress: 1 }, { index, alpha: inScene / fade, progress }];
  }
  return [{ index, alpha: 1, progress }];
}

/* ── the camera ────────────────────────────────────────────────────────── */

const ease = (p: number) => p * p * (3 - 2 * p);

/** Zoom factor (1 or more) and sideways position (-1 left to 1 right) of the camera at progress p of a scene. */
export function motionAt(motion: Motion, progress: number): { zoom: number; pan: number } {
  const p = ease(Math.min(1, Math.max(0, progress)));
  const z = STORYBOARD.zoomAmount;
  switch (motion) {
    case 'zoom-in': return { zoom: 1 + z * p, pan: 0 };
    case 'zoom-out': return { zoom: 1 + z * (1 - p), pan: 0 };
    case 'pan-left': return { zoom: 1 + z, pan: 1 - 2 * p };
    case 'pan-right': return { zoom: 1 + z, pan: -1 + 2 * p };
  }
}

/**
 * Where the picture is drawn inside the frame. The picture first covers the frame (cropped, never stretched), then
 * the camera zoom and sideways move are applied. The result always covers the whole frame, so no black edge ever shows.
 */
export function sceneRect(imgW: number, imgH: number, frameW: number, frameH: number, motion: Motion, progress: number): Rect {
  const base = fitRect(imgW, imgH, frameW, frameH, 'cover');
  const { zoom, pan } = motionAt(motion, progress);
  const w = base.w * zoom;
  const h = base.h * zoom;
  const slack = Math.max(0, w - frameW);
  return { x: (frameW - w) / 2 + (pan * slack) / 2, y: (frameH - h) / 2, w, h };
}

/* ── scenes ────────────────────────────────────────────────────────────── */

export const isMotion = (m: unknown): m is Motion => typeof m === 'string' && (MOTIONS as readonly string[]).includes(m);

const clampSeconds = (n: unknown): number => {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : STORYBOARD.defaultSeconds;
  return Math.min(STORYBOARD.maxSeconds, Math.max(STORYBOARD.minSeconds, Math.round(v * 2) / 2));
};

/** A blank scene. Alternating camera moves keep consecutive scenes from feeling the same. */
export function blankScene(id: string, index = 0): Scene {
  return { id, caption: '', picture: '', seconds: STORYBOARD.defaultSeconds, motion: MOTIONS[index % MOTIONS.length] };
}

/** Problems that stop an export. Empty when the storyboard can be made into a video. */
export function storyboardIssues(scenes: Scene[], hasPicture: (id: string) => boolean): string[] {
  const out: string[] = [];
  if (scenes.length < STORYBOARD.minScenes) out.push(`Add at least ${STORYBOARD.minScenes} scenes.`);
  if (scenes.length > STORYBOARD.maxScenes) out.push(`Use at most ${STORYBOARD.maxScenes} scenes.`);
  const total = totalSeconds(scenes);
  if (total > STORYBOARD.maxTotalSeconds) out.push(`The video is ${total} seconds. The limit is ${STORYBOARD.maxTotalSeconds}, because it is recorded in real time in your browser.`);
  scenes.forEach((s, i) => {
    if (!hasPicture(s.id)) out.push(`Scene ${i + 1} has no picture yet.`);
    if (s.caption.length > STORYBOARD.captionMax) out.push(`The caption in scene ${i + 1} is over ${STORYBOARD.captionMax} characters.`);
    if (!Number.isFinite(s.seconds) || s.seconds < STORYBOARD.minSeconds || s.seconds > STORYBOARD.maxSeconds) out.push(`Scene ${i + 1} must last ${STORYBOARD.minSeconds} to ${STORYBOARD.maxSeconds} seconds.`);
  });
  return out;
}

/* ── the model's storyboard ────────────────────────────────────────────── */

export type PlannedScene = Omit<Scene, 'id'>;
export type PlannedStoryboard = { title: string; scenes: PlannedScene[] };

const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Checks what the model returned. Camera moves and lengths are fixed up quietly (they are cosmetic); the scene
 * count, the words and any figure or promise in a caption are not: a caption may only use numbers the creator gave.
 */
export function validateStoryboard(raw: unknown, ctx: { scenes: number; allowedNumbers: Set<number> }): Validated<PlannedStoryboard> {
  if (!isObj(raw) || !Array.isArray(raw.scenes)) return { ok: false, reasons: ['the answer must be an object with a "scenes" array'] };
  const reasons: string[] = [];
  const title = str(raw.title).slice(0, STORYBOARD.titleMax);
  if (title.length < 2) reasons.push('title is missing');
  if (raw.scenes.length < ctx.scenes) reasons.push(`exactly ${ctx.scenes} scenes are required, got ${raw.scenes.length}`);
  const scenes: PlannedScene[] = [];
  raw.scenes.slice(0, ctx.scenes).forEach((s, i) => {
    if (!isObj(s)) { reasons.push(`scenes[${i}] is not an object`); return; }
    const caption = str(s.caption);
    const picture = str(s.picture);
    if (caption.length > STORYBOARD.captionMax) reasons.push(`scenes[${i}].caption is over ${STORYBOARD.captionMax} characters`);
    if (picture.length < STORYBOARD.pictureMin || picture.length > STORYBOARD.pictureMax) reasons.push(`scenes[${i}].picture must be ${STORYBOARD.pictureMin} to ${STORYBOARD.pictureMax} characters`);
    reasons.push(...scanText(caption, ctx.allowedNumbers, `scenes[${i}].caption`));
    scenes.push({ caption, picture, seconds: clampSeconds(s.seconds), motion: isMotion(s.motion) ? s.motion : MOTIONS[i % MOTIONS.length] });
  });
  // Keep the whole video under the cap by trimming the longest scenes first.
  let guard = 0;
  while (totalSeconds(scenes) > STORYBOARD.maxTotalSeconds && guard < 200) {
    const longest = scenes.reduce((best, s, i) => (s.seconds > scenes[best].seconds ? i : best), 0);
    scenes[longest] = { ...scenes[longest], seconds: Math.max(STORYBOARD.minSeconds, scenes[longest].seconds - 0.5) };
    guard += 1;
  }
  const unique = Array.from(new Set(reasons));
  return unique.length ? { ok: false, reasons: unique } : { ok: true, value: { title, scenes } };
}

/** Every number the creator supplied, so a caption can repeat them and nothing else. */
export const allowedNumbersFor = (...sources: unknown[]): Set<number> => collectNumbers(sources);

/** The text sent to the picture service for one scene: the description, the chosen look, and a ban on writing in the picture. */
export function picturePrompt(picture: string, style: StyleKey): string {
  return `${picture.trim()}. ${STYLES[style].suffix}. No text, no letters, no logos, no watermark.`;
}
