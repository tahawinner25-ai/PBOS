'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  applyPrefs, DEFAULT_PREFS, DISPLAY_STORAGE_KEY, isDefault, parsePrefs, type DisplayPrefs,
} from '@/lib/display-prefs';
import { cn } from '@/lib/utils';

type Option<K extends keyof DisplayPrefs> = { value: DisplayPrefs[K]; label: string };

const GROUPS: Array<{ key: keyof DisplayPrefs; legend: string; hint?: string; options: Array<Option<keyof DisplayPrefs>> }> = [
  { key: 'textSize', legend: 'Text size', options: [{ value: 'default', label: 'Standard' }, { value: 'large', label: 'Large' }, { value: 'larger', label: 'Larger' }, { value: 'largest', label: 'Largest' }] },
  { key: 'contrast', legend: 'Contrast', options: [{ value: 'default', label: 'Standard' }, { value: 'high', label: 'High' }] },
  { key: 'font', legend: 'Typeface', hint: 'A wide, plain font with more space between letters and lines.', options: [{ value: 'default', label: 'Standard' }, { value: 'readable', label: 'Easy to read' }] },
  { key: 'motion', legend: 'Motion', hint: 'Standard follows your device’s setting.', options: [{ value: 'system', label: 'Standard' }, { value: 'reduce', label: 'Reduce motion' }] },
];

/**
 * A disclosure panel for display choices. They apply at once, are remembered in this browser only, and never
 * leave it. Native radio groups keep it fully usable by keyboard and screen reader.
 */
export function DisplaySettings({ className, align = 'left' }: { className?: string; align?: 'left' | 'right' }) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Read what the head script already applied, so the radios show the real state.
  useEffect(() => {
    try { setPrefs(parsePrefs(window.localStorage.getItem(DISPLAY_STORAGE_KEY))); } catch { /* storage blocked: choices still apply for this visit */ }
  }, []);

  // Escape closes the panel and returns focus to its button; clicking elsewhere closes it too.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onDown = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [open]);

  function update(next: DisplayPrefs) {
    setPrefs(next);
    applyPrefs(document.documentElement, next);
    try {
      if (isDefault(next)) window.localStorage.removeItem(DISPLAY_STORAGE_KEY);
      else window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(next));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  return (
    <div ref={root} className={cn('relative inline-block', className)}>
      <Button ref={button} variant="ghost" size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)} className="h-auto px-0 py-1 text-sm font-normal text-muted-foreground hover:bg-transparent hover:text-foreground">
        Display settings
      </Button>
      <div
        id={panelId}
        role="group"
        aria-label="Display settings"
        hidden={!open}
        className={cn('absolute bottom-full z-50 mb-2 w-72 max-w-[calc(100vw-2rem)] space-y-4 rounded-lg border border-border bg-popover p-4 text-sm text-popover-foreground shadow-lg', align === 'right' ? 'right-0' : 'left-0')}
      >
        {GROUPS.map((g) => (
          <fieldset key={g.key} className="space-y-1.5">
            <legend className="font-medium">{g.legend}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {g.options.map((o) => (
                <label key={o.value} className="flex min-h-6 items-center gap-1.5">
                  <input type="radio" name={`display-${g.key}`} value={o.value} checked={prefs[g.key] === o.value} onChange={() => update({ ...prefs, [g.key]: o.value } as DisplayPrefs)} />
                  {o.label}
                </label>
              ))}
            </div>
            {g.hint ? <p className="text-xs text-muted-foreground">{g.hint}</p> : null}
          </fieldset>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
          <Button size="sm" variant="outline" onClick={() => update(DEFAULT_PREFS)} disabled={isDefault(prefs)}>Reset</Button>
          <p className="text-xs text-muted-foreground" role="status">{saved ? 'Saved on this device only.' : 'Could not save. Applies to this visit only.'}</p>
        </div>
      </div>
    </div>
  );
}
