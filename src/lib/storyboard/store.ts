/**
 * Keeps an unfinished storyboard video in this browser (IndexedDB), so a reload, a closed tab or a crash does not
 * throw away the scenes and the pictures that took minutes to make. It is saved on THIS device and browser only,
 * never sent anywhere, and the creator can clear it. Everything read back is checked, because storage is not trusted.
 *
 * `parseDraft` is pure and tested. The IndexedDB wrapper below it needs a browser and fails quietly: if storage is
 * blocked (private window, full disk), the editor still works, it just cannot remember.
 */
import { OWN_AUDIO_MAX_BYTES, cleanSound, type SoundSettings } from './audio';
import { MOTIONS, STORYBOARD, isMotion, isShape, isStyle, type Scene, type StyleKey } from './plan';
import type { AspectKey } from '../studio/edl';

export const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
const VERSION = 1;

export type StoredPicture = { blob: Blob; width: number; height: number; origin: 'free' | 'upload' };
export type StoredDraft = {
  version: number;
  savedAt: number;
  topic: string;
  title: string;
  shape: AspectKey;
  style: StyleKey;
  scenes: Scene[];
  sound: SoundSettings;
  pictures: Record<string, StoredPicture>;
  ownAudio: { name: string; blob: Blob } | null;
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const isBlob = (v: unknown): v is Blob => typeof Blob !== 'undefined' && v instanceof Blob;

/** Checks and cleans what came out of storage. Returns null when it is not a usable draft. */
export function parseDraft(raw: unknown): StoredDraft | null {
  if (!isObj(raw) || raw.version !== VERSION || !Array.isArray(raw.scenes) || raw.scenes.length === 0) return null;
  const shape = isShape(raw.shape) ? raw.shape : '9:16';
  const style = isStyle(raw.style) ? raw.style : 'photo';
  const seen = new Set<string>();
  const scenes: Scene[] = [];
  for (const s of raw.scenes) {
    if (scenes.length >= STORYBOARD.maxScenes) break;
    if (!isObj(s) || typeof s.id !== 'string' || s.id.length === 0 || s.id.length > 80 || seen.has(s.id)) continue;
    seen.add(s.id);
    const seconds = typeof s.seconds === 'number' && Number.isFinite(s.seconds) ? Math.min(STORYBOARD.maxSeconds, Math.max(STORYBOARD.minSeconds, s.seconds)) : STORYBOARD.defaultSeconds;
    scenes.push({ id: s.id, caption: text(s.caption, STORYBOARD.captionMax), picture: text(s.picture, STORYBOARD.pictureMax), seconds, motion: isMotion(s.motion) ? s.motion : MOTIONS[scenes.length % MOTIONS.length] });
  }
  if (scenes.length === 0) return null;
  const pictures: Record<string, StoredPicture> = {};
  if (isObj(raw.pictures)) {
    for (const [id, p] of Object.entries(raw.pictures)) {
      if (!seen.has(id) || !isObj(p) || !isBlob(p.blob) || p.blob.size === 0 || p.blob.size > PICTURE_MAX_BYTES) continue;
      const width = typeof p.width === 'number' && p.width > 0 && p.width < 20_000 ? p.width : 0;
      const height = typeof p.height === 'number' && p.height > 0 && p.height < 20_000 ? p.height : 0;
      if (!width || !height) continue;
      pictures[id] = { blob: p.blob, width, height, origin: p.origin === 'upload' ? 'upload' : 'free' };
    }
  }
  const own = isObj(raw.ownAudio) && isBlob(raw.ownAudio.blob) && raw.ownAudio.blob.size > 0 && raw.ownAudio.blob.size <= OWN_AUDIO_MAX_BYTES
    ? { name: text(raw.ownAudio.name, 120) || 'Your audio', blob: raw.ownAudio.blob }
    : null;
  return {
    version: VERSION,
    savedAt: typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : 0,
    topic: text(raw.topic, STORYBOARD.topicMax),
    title: text(raw.title, STORYBOARD.titleMax),
    shape,
    style,
    scenes,
    sound: cleanSound(isObj(raw.sound) ? (raw.sound as Partial<SoundSettings>) : null),
    pictures,
    ownAudio: own,
  };
}

export const buildDraft = (d: Omit<StoredDraft, 'version' | 'savedAt'>, now: number = Date.now()): StoredDraft => ({ ...d, version: VERSION, savedAt: now });

/** A draft worth restoring has some work in it: a picture, or words in a scene. */
export const hasWork = (d: Pick<StoredDraft, 'scenes' | 'pictures'>): boolean => Object.keys(d.pictures).length > 0 || d.scenes.some((s) => s.caption.trim() || s.picture.trim());

/* ── IndexedDB (browser only) ──────────────────────────────────────────── */

const DB = 'pbos-video';
const STORE = 'drafts';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no storage')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('storage error'));
    req.onblocked = () => reject(new Error('storage blocked'));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('storage error'));
      tx.onabort = () => reject(tx.error ?? new Error('storage aborted'));
    });
  } finally {
    db.close();
  }
}

const keyFor = (owner: string) => `draft:${owner}`;

/** The saved draft for this creator, or null when there is none or storage is unavailable. */
export async function loadDraft(owner: string): Promise<StoredDraft | null> {
  try { return parseDraft(await run('readonly', (s) => s.get(keyFor(owner)))); } catch { return null; }
}

/** Saves the draft. Resolves false (and the editor carries on) when the browser refuses, for example when storage is full. */
export async function saveDraft(owner: string, draft: StoredDraft): Promise<boolean> {
  try { await run('readwrite', (s) => s.put(draft, keyFor(owner))); return true; } catch { return false; }
}

export async function clearDraft(owner: string): Promise<void> {
  try { await run('readwrite', (s) => s.delete(keyFor(owner))); } catch { /* nothing to clear, or storage is unavailable */ }
}
