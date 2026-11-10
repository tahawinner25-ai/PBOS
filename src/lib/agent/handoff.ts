import { MOTIONS, STORYBOARD, STYLES, isMotion, isShape, isStyle, totalSeconds, type Motion, type StyleKey } from '../storyboard/plan';
import { COLORS, LIMITS as EDIT, POSITIONS, SIZES, type AspectKey, type FitMode, type Overlay } from '../studio/edl';

/**
 * "Hand-off" plans. Making a video happens in the creator's browser (the Video page animates and records pictures, the
 * Studio cuts and records footage), so the agent cannot render one itself. What it CAN do is the thinking: write the
 * scenes, or choose the clips, trims and captions. That plan is stored on the agent's own activity row, and a link on the
 * card (`/video?plan=<id>` or `/studio?plan=<id>`) opens the page with the plan loaded. Nothing is rendered, saved to the
 * library or posted until the creator presses the page's own buttons.
 *
 * Pure: these functions check a plan, whether it came from the model or back out of storage.
 */

export const HANDOFF_TOOLS = ['plan_video', 'plan_edit'] as const;
export type HandoffTool = (typeof HANDOFF_TOOLS)[number];
export const isHandoffTool = (t: string): t is HandoffTool => (HANDOFF_TOOLS as readonly string[]).includes(t);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPlanId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Where the card's "Open" link goes. Only a stored activity row id is ever put in the link, never plan content. */
export function handoffHref(tool: string, actionId: string | null | undefined, base: string): string {
  const path = base.split('?')[0];
  return isHandoffTool(tool) && isPlanId(actionId) ? `${path}?plan=${actionId}` : base;
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
const err = (error: string): { ok: false; error: string } => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const round = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* ── a storyboard video ────────────────────────────────────────────────── */

export type VideoPlanScene = { caption: string; picture: string; seconds: number; motion: Motion };
export type VideoPlan = { topic: string; title: string; shape: AspectKey; style: StyleKey; scenes: VideoPlanScene[] };

export const VIDEO_PLAN_KEYS = ['topic', 'title', 'shape', 'style', 'scenes'] as const;
export const SCENE_KEYS = ['caption', 'picture', 'seconds', 'motion'] as const;

export function cleanVideoPlan(raw: unknown): Checked<VideoPlan> {
  if (!isObj(raw)) return err('The plan must be a JSON object.');
  const topic = typeof raw.topic === 'string' ? raw.topic.trim() : '';
  if (topic.length < STORYBOARD.topicMin || topic.length > STORYBOARD.topicMax) return err(`topic must be ${STORYBOARD.topicMin} to ${STORYBOARD.topicMax} characters.`);
  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (title.length < 2 || title.length > STORYBOARD.titleMax) return err(`title must be 2 to ${STORYBOARD.titleMax} characters.`);
  const shape = raw.shape === undefined ? '9:16' : raw.shape;
  if (!isShape(shape)) return err('shape must be 9:16, 1:1 or 16:9.');
  const style = raw.style === undefined ? 'photo' : raw.style;
  if (!isStyle(style)) return err(`style must be one of: ${Object.keys(STYLES).join(', ')}.`);
  if (!Array.isArray(raw.scenes) || raw.scenes.length < STORYBOARD.minScenes || raw.scenes.length > STORYBOARD.maxScenes) return err(`scenes must be a list of ${STORYBOARD.minScenes} to ${STORYBOARD.maxScenes} scenes.`);
  const scenes: VideoPlanScene[] = [];
  for (const [i, s] of raw.scenes.entries()) {
    if (!isObj(s)) return err(`Scene ${i + 1} must be an object.`);
    const extra = Object.keys(s).find((k) => !(SCENE_KEYS as readonly string[]).includes(k));
    if (extra) return err(`Scene ${i + 1} has an unknown field “${extra}”. Allowed: ${SCENE_KEYS.join(', ')}.`);
    const caption = typeof s.caption === 'string' ? s.caption.trim() : '';
    if (caption.length > STORYBOARD.captionMax) return err(`The caption in scene ${i + 1} is over ${STORYBOARD.captionMax} characters.`);
    const picture = typeof s.picture === 'string' ? s.picture.trim() : '';
    if (picture.length < STORYBOARD.pictureMin || picture.length > STORYBOARD.pictureMax) return err(`The picture description in scene ${i + 1} must be ${STORYBOARD.pictureMin} to ${STORYBOARD.pictureMax} characters.`);
    const seconds = s.seconds === undefined ? STORYBOARD.defaultSeconds : num(s.seconds);
    if (seconds === null || seconds < STORYBOARD.minSeconds || seconds > STORYBOARD.maxSeconds) return err(`Scene ${i + 1} must last ${STORYBOARD.minSeconds} to ${STORYBOARD.maxSeconds} seconds.`);
    const motion = s.motion === undefined ? MOTIONS[i % MOTIONS.length] : s.motion;
    if (!isMotion(motion)) return err(`motion in scene ${i + 1} must be one of: ${MOTIONS.join(', ')}.`);
    scenes.push({ caption, picture, seconds: round(seconds), motion });
  }
  const total = totalSeconds(scenes);
  if (total > STORYBOARD.maxTotalSeconds) return err(`The scenes add up to ${total} seconds. The limit is ${STORYBOARD.maxTotalSeconds}.`);
  return { ok: true, value: { topic, title, shape, style, scenes } };
}

/* ── an edit of the creator's imported videos ──────────────────────────── */

export type EditPlanClip = { media_id: string; start: number; end: number; volume: number };
export type EditPlanText = { text: string; start: number; end: number; position: Overlay['position']; size: Overlay['size']; color: Overlay['color']; box: boolean };
export type EditPlan = { aspect: AspectKey; fit: FitMode; clips: EditPlanClip[]; texts: EditPlanText[] };

export const EDIT_PLAN_KEYS = ['aspect', 'fit', 'clips', 'texts'] as const;
export const EDIT_CLIP_KEYS = ['media_id', 'start', 'end', 'volume'] as const;
export const EDIT_TEXT_KEYS = ['text', 'start', 'end', 'position', 'size', 'color', 'box'] as const;
export const EDIT_PLAN_MAX_CLIPS = 12;
export const EDIT_PLAN_MAX_TEXTS = 10;

export function cleanEditPlan(raw: unknown): Checked<EditPlan> {
  if (!isObj(raw)) return err('The plan must be a JSON object.');
  const aspect = raw.aspect === undefined ? '9:16' : raw.aspect;
  if (!isShape(aspect)) return err('aspect must be 9:16, 1:1 or 16:9.');
  const fit = raw.fit === undefined ? 'cover' : raw.fit;
  if (fit !== 'cover' && fit !== 'contain') return err('fit must be cover or contain.');
  if (!Array.isArray(raw.clips) || raw.clips.length < 1 || raw.clips.length > EDIT_PLAN_MAX_CLIPS) return err(`clips must be a list of 1 to ${EDIT_PLAN_MAX_CLIPS} clips.`);
  const clips: EditPlanClip[] = [];
  for (const [i, c] of raw.clips.entries()) {
    if (!isObj(c)) return err(`Clip ${i + 1} must be an object.`);
    const extra = Object.keys(c).find((k) => !(EDIT_CLIP_KEYS as readonly string[]).includes(k));
    if (extra) return err(`Clip ${i + 1} has an unknown field “${extra}”. Allowed: ${EDIT_CLIP_KEYS.join(', ')}.`);
    if (!isPlanId(c.media_id)) return err(`Clip ${i + 1}: media_id must be the id of a video from list_records kind media.`);
    const start = num(c.start);
    const end = num(c.end);
    if (start === null || end === null || start < 0) return err(`Clip ${i + 1}: start and end are seconds inside the source video, start 0 or more.`);
    if (end - start < EDIT.minClip) return err(`Clip ${i + 1} must be at least ${EDIT.minClip} seconds long.`);
    const volume = c.volume === undefined ? 1 : num(c.volume);
    if (volume === null || volume < 0 || volume > 1) return err(`Clip ${i + 1}: volume is from 0 (silent) to 1 (original).`);
    clips.push({ media_id: c.media_id.toLowerCase(), start: round(start), end: round(end), volume: round(volume) });
  }
  const total = round(clips.reduce((n, c) => n + (c.end - c.start), 0));
  if (total > EDIT.maxSeconds) return err(`The clips add up to ${total} seconds. The limit is ${EDIT.maxSeconds}.`);
  const textsIn = raw.texts === undefined ? [] : raw.texts;
  if (!Array.isArray(textsIn) || textsIn.length > EDIT_PLAN_MAX_TEXTS) return err(`texts must be a list of up to ${EDIT_PLAN_MAX_TEXTS} captions.`);
  const texts: EditPlanText[] = [];
  for (const [i, t] of textsIn.entries()) {
    if (!isObj(t)) return err(`Text ${i + 1} must be an object.`);
    const extra = Object.keys(t).find((k) => !(EDIT_TEXT_KEYS as readonly string[]).includes(k));
    if (extra) return err(`Text ${i + 1} has an unknown field “${extra}”. Allowed: ${EDIT_TEXT_KEYS.join(', ')}.`);
    const text = typeof t.text === 'string' ? t.text.trim() : '';
    if (text.length < 1 || text.length > EDIT.overlayText) return err(`Text ${i + 1} must be 1 to ${EDIT.overlayText} characters.`);
    const start = num(t.start);
    const end = num(t.end);
    if (start === null || end === null || start < 0 || end - start < 0.2) return err(`Text ${i + 1}: start and end are seconds on the finished timeline and it must show for at least 0.2 seconds.`);
    if (end > total + 1e-6) return err(`Text ${i + 1} ends at ${round(end)} s, after the edit ends (${total} s).`);
    const position = t.position === undefined ? 'bottom' : t.position;
    const size = t.size === undefined ? 'medium' : t.size;
    const color = t.color === undefined ? 'white' : t.color;
    if (!(POSITIONS as readonly unknown[]).includes(position)) return err(`Text ${i + 1}: position must be ${POSITIONS.join(', ')}.`);
    if (!(SIZES as readonly unknown[]).includes(size)) return err(`Text ${i + 1}: size must be ${SIZES.join(', ')}.`);
    if (!(COLORS as readonly unknown[]).includes(color)) return err(`Text ${i + 1}: color must be ${COLORS.join(', ')}.`);
    if (t.box !== undefined && typeof t.box !== 'boolean') return err(`Text ${i + 1}: box must be true or false.`);
    texts.push({ text, start: round(start), end: round(end), position: position as Overlay['position'], size: size as Overlay['size'], color: color as Overlay['color'], box: t.box === undefined ? true : t.box });
  }
  return { ok: true, value: { aspect, fit, clips, texts } };
}
