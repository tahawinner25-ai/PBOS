/**
 * Display choices a visitor can make for themselves: text size, contrast, an easier-to-read font and less motion.
 * They are stored only in this browser (local storage, key below), never sent to a server, and applied as
 * data attributes on <html> that globals.css reads. This file is pure so the rules are tested without a browser.
 */

export const DISPLAY_STORAGE_KEY = 'pbos-display';

export const TEXT_SIZES = ['default', 'large', 'larger', 'largest'] as const;
export const CONTRASTS = ['default', 'high'] as const;
export const FONTS = ['default', 'readable'] as const;
export const MOTIONS = ['system', 'reduce'] as const;

export type DisplayPrefs = {
  textSize: (typeof TEXT_SIZES)[number];
  contrast: (typeof CONTRASTS)[number];
  font: (typeof FONTS)[number];
  motion: (typeof MOTIONS)[number];
};

export const DEFAULT_PREFS: DisplayPrefs = { textSize: 'default', contrast: 'default', font: 'default', motion: 'system' };

/** The attribute each setting is written to on <html>. */
export const ATTRIBUTES: Record<keyof DisplayPrefs, string> = {
  textSize: 'data-text-size',
  contrast: 'data-contrast',
  font: 'data-font',
  motion: 'data-motion',
};

const pick = <T extends string>(allowed: readonly T[], value: unknown, fallback: T): T => (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback);

/** Reads whatever is in storage. Anything missing, malformed or out of range falls back to the default for that field. */
export function parsePrefs(raw: string | null | undefined): DisplayPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return { ...DEFAULT_PREFS }; }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...DEFAULT_PREFS };
  const d = data as Record<string, unknown>;
  return {
    textSize: pick(TEXT_SIZES, d.textSize, DEFAULT_PREFS.textSize),
    contrast: pick(CONTRASTS, d.contrast, DEFAULT_PREFS.contrast),
    font: pick(FONTS, d.font, DEFAULT_PREFS.font),
    motion: pick(MOTIONS, d.motion, DEFAULT_PREFS.motion),
  };
}

export const isDefault = (p: DisplayPrefs): boolean => (Object.keys(DEFAULT_PREFS) as Array<keyof DisplayPrefs>).every((k) => p[k] === DEFAULT_PREFS[k]);

/** Writes the choices onto an element. A default value removes its attribute so the stylesheet's own defaults apply. */
export function applyPrefs(root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>, prefs: DisplayPrefs): void {
  for (const key of Object.keys(ATTRIBUTES) as Array<keyof DisplayPrefs>) {
    if (prefs[key] === DEFAULT_PREFS[key]) root.removeAttribute(ATTRIBUTES[key]);
    else root.setAttribute(ATTRIBUTES[key], prefs[key]);
  }
}

/**
 * A tiny script for <head> that applies saved choices before the first paint, so a large-text reader never sees
 * the page jump. It repeats the validation above in miniature and does nothing if storage is unavailable.
 * The only values it can write are the fixed strings below, so a tampered storage entry cannot inject anything.
 */
export const DISPLAY_INIT_SCRIPT = `(function(){try{var d=JSON.parse(localStorage.getItem(${JSON.stringify(DISPLAY_STORAGE_KEY)})||'{}');var r=document.documentElement;var m=${JSON.stringify({
  textSize: { attr: ATTRIBUTES.textSize, ok: TEXT_SIZES.filter((v) => v !== 'default') },
  contrast: { attr: ATTRIBUTES.contrast, ok: CONTRASTS.filter((v) => v !== 'default') },
  font: { attr: ATTRIBUTES.font, ok: FONTS.filter((v) => v !== 'default') },
  motion: { attr: ATTRIBUTES.motion, ok: MOTIONS.filter((v) => v !== 'system') },
})};for(var k in m){var v=d&&d[k];if(typeof v==='string'&&m[k].ok.indexOf(v)>-1)r.setAttribute(m[k].attr,v)}}catch(e){}})();`;
