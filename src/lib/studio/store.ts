import { COLORS, LIMITS, POSITIONS, SIZES, type Clip, type Overlay, type Project } from './edl';

/**
 * Keeps the Studio's work in this browser (IndexedDB) so it survives leaving the page, a reload or a closed tab: the
 * timeline AND the video files it uses, until the creator downloads or saves the finished edit, or starts over.
 * Saved on this browser only, never uploaded. Everything read back is checked again, because stored data is only data.
 */

export type StoredSource = { label: string; origin: 'library' | 'local'; duration: number; width: number; height: number; blob: Blob };
export type StoredStudio = { version: 1; savedAt: number; project: Project; sources: Record<string, StoredSource> };

const VERSION = 1;
const MAX_SOURCES = LIMITS.maxClips;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

function parseClip(raw: unknown): Clip | null {
  if (!isObj(raw) || !str(raw.id, 80) || !str(raw.sourceId, 120) || !str(raw.label, 300)) return null;
  const { sourceDuration, start, end, volume } = raw;
  if (!num(sourceDuration) || !num(start) || !num(end) || !num(volume)) return null;
  if (sourceDuration <= 0 || start < 0 || end <= start || end > sourceDuration + 1e-6 || volume < 0 || volume > 1) return null;
  return { id: raw.id, sourceId: raw.sourceId, label: raw.label, sourceDuration, start, end, volume };
}

function parseOverlay(raw: unknown): Overlay | null {
  if (!isObj(raw) || !str(raw.id, 80) || !str(raw.text, LIMITS.overlayText)) return null;
  const { start, end, position, size, color, box } = raw;
  if (!num(start) || !num(end) || start < 0 || end <= start) return null;
  if (!(POSITIONS as readonly unknown[]).includes(position) || !(SIZES as readonly unknown[]).includes(size) || !(COLORS as readonly unknown[]).includes(color) || typeof box !== 'boolean') return null;
  return { id: raw.id, text: raw.text, start, end, position: position as Overlay['position'], size: size as Overlay['size'], color: color as Overlay['color'], box };
}

/** Returns a safe save, or null if anything about it is wrong. Clips that point at a missing video make the whole save unusable. */
export function parseStudioSave(raw: unknown): StoredStudio | null {
  if (!isObj(raw) || raw.version !== VERSION || !num(raw.savedAt) || !isObj(raw.project) || !isObj(raw.sources)) return null;
  const p = raw.project;
  if (!['9:16', '1:1', '16:9'].includes(p.aspect as string) || (p.fit !== 'cover' && p.fit !== 'contain')) return null;
  if (!Array.isArray(p.clips) || p.clips.length === 0 || p.clips.length > LIMITS.maxClips || !Array.isArray(p.overlays) || p.overlays.length > 40) return null;
  const clips: Clip[] = [];
  for (const c of p.clips) { const ok = parseClip(c); if (!ok) return null; clips.push(ok); }
  const overlays: Overlay[] = [];
  for (const o of p.overlays) { const ok = parseOverlay(o); if (!ok) return null; overlays.push(ok); }
  const entries = Object.entries(raw.sources);
  if (entries.length > MAX_SOURCES) return null;
  const sources: Record<string, StoredSource> = {};
  for (const [key, v] of entries) {
    if (!str(key, 120) || !isObj(v) || !str(v.label, 300) || (v.origin !== 'library' && v.origin !== 'local')) return null;
    if (!num(v.duration) || v.duration <= 0 || !num(v.width) || !num(v.height) || !(v.blob instanceof Blob) || v.blob.size === 0) return null;
    sources[key] = { label: v.label, origin: v.origin, duration: v.duration, width: v.width, height: v.height, blob: v.blob };
  }
  if (clips.some((c) => !sources[c.sourceId])) return null;
  return { version: VERSION, savedAt: raw.savedAt, project: { aspect: p.aspect as Project['aspect'], fit: p.fit as Project['fit'], clips, overlays }, sources };
}

export const buildStudioSave = (project: Project, sources: Record<string, StoredSource>, now: number = Date.now()): StoredStudio => {
  const used = new Set(project.clips.map((c) => c.sourceId));
  return { version: VERSION, savedAt: now, project, sources: Object.fromEntries(Object.entries(sources).filter(([k]) => used.has(k))) };
};

/* ── IndexedDB (browser only) ──────────────────────────────────────────── */

const DB = 'pbos-studio';
const STORE = 'projects';

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

const keyFor = (owner: string) => `project:${owner}`;

export async function loadStudio(owner: string): Promise<StoredStudio | null> {
  try { return parseStudioSave(await run('readonly', (s) => s.get(keyFor(owner)))); } catch { return null; }
}

/** Resolves false (and the editor carries on) when the browser refuses, for example when storage is full. */
export async function saveStudio(owner: string, save: StoredStudio): Promise<boolean> {
  try { await run('readwrite', (s) => s.put(save, keyFor(owner))); return true; } catch { return false; }
}

export async function clearStudio(owner: string): Promise<void> {
  try { await run('readwrite', (s) => s.delete(keyFor(owner))); } catch { /* nothing to clear, or storage is unavailable */ }
}
