'use client';

import { ArrowLeft, ArrowRight, Trash2 } from 'lucide-react';
import { NumberField } from '@/components/studio-fields';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { clipLength, COLORS, formatTime, LIMITS, POSITIONS, SIZES, type Clip, type Overlay, type OverlayPatch } from '@/lib/studio/edl';

const LABELS = {
  position: { top: 'Top', middle: 'Middle', bottom: 'Bottom' },
  size: { small: 'Small', medium: 'Medium', large: 'Large' },
  color: { white: 'White', yellow: 'Yellow', black: 'Black' },
} as const;

/** Trim, volume, order and removal for the selected clip. Every control is a native input, so it works with a keyboard and a screen reader. */
export function ClipInspector({ clip, index, count, playhead, onTrim, onVolume, onMove, onRemove }: {
  clip: Clip; index: number; count: number; playhead: number | null;
  onTrim: (start: number, end: number) => void; onVolume: (v: number) => void; onMove: (dir: -1 | 1) => void; onRemove: () => void;
}) {
  const id = `clip-${clip.id}`;
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h3 id={`${id}-h`} className="font-serif text-lg">Clip {index + 1} of {count}</h3>
        <p className="truncate text-sm text-muted-foreground" title={clip.label}>{clip.label} · {formatTime(clipLength(clip))} used of {formatTime(clip.sourceDuration)}</p>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Trim</legend>
        <div className="space-y-1">
          <label htmlFor={`${id}-in`} className="text-xs font-medium">Start point</label>
          <input id={`${id}-in`} type="range" className="w-full" min={0} max={clip.sourceDuration} step={0.1} value={clip.start} aria-valuetext={`${formatTime(clip.start)}`} onChange={(e) => onTrim(Number(e.target.value), clip.end)} />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${id}-out`} className="text-xs font-medium">End point</label>
          <input id={`${id}-out`} type="range" className="w-full" min={0} max={clip.sourceDuration} step={0.1} value={clip.end} aria-valuetext={`${formatTime(clip.end)}`} onChange={(e) => onTrim(clip.start, Number(e.target.value))} />
        </div>
        <div className="flex flex-wrap gap-4">
          <NumberField id={`${id}-in-n`} label="Start (seconds)" value={clip.start} min={0} max={clip.sourceDuration} onCommit={(n) => onTrim(n, clip.end)} />
          <NumberField id={`${id}-out-n`} label="End (seconds)" value={clip.end} min={0} max={clip.sourceDuration} onCommit={(n) => onTrim(clip.start, n)} />
        </div>
        <p className="text-xs text-muted-foreground">Times are positions inside the original video. At least {LIMITS.minClip} seconds must remain.{playhead !== null ? ` The playhead is ${formatTime(playhead)} into the original video.` : ''}</p>
      </fieldset>

      <div className="space-y-1">
        <label htmlFor={`${id}-vol`} className="text-sm font-medium">Volume: {Math.round(clip.volume * 100)}%</label>
        <input id={`${id}-vol`} type="range" className="w-full" min={0} max={1} step={0.05} value={clip.volume} aria-valuetext={clip.volume === 0 ? 'Muted' : `${Math.round(clip.volume * 100)} percent`} onChange={(e) => onVolume(Number(e.target.value))} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={clip.volume === 0} onChange={(e) => onVolume(e.target.checked ? 0 : 1)} /> Mute this clip</label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => onMove(-1)} disabled={index === 0}><ArrowLeft aria-hidden="true" /> Move earlier</Button>
        <Button size="sm" variant="outline" onClick={() => onMove(1)} disabled={index === count - 1}>Move later <ArrowRight aria-hidden="true" /></Button>
        <Button size="sm" variant="outline" onClick={onRemove}><Trash2 aria-hidden="true" /> Remove clip</Button>
      </div>
    </section>
  );
}

export function TextInspector({ overlay, total, onChange, onRemove }: { overlay: Overlay; total: number; onChange: (patch: OverlayPatch) => void; onRemove: () => void }) {
  const id = `text-${overlay.id}`;
  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h3 id={`${id}-h`} className="font-serif text-lg">Text</h3>
      <div className="space-y-1">
        <label htmlFor={`${id}-t`} className="text-xs font-medium">What it says</label>
        <Input id={`${id}-t`} value={overlay.text} maxLength={LIMITS.overlayText} onChange={(e) => onChange({ text: e.target.value })} aria-describedby={`${id}-count`} />
        <p id={`${id}-count`} className="text-xs text-muted-foreground">{overlay.text.length}/{LIMITS.overlayText}. Burned into the picture, so keep it short.</p>
      </div>
      <div className="flex flex-wrap gap-4">
        <NumberField id={`${id}-s`} label="Shows from (seconds)" value={overlay.start} min={0} max={total} onCommit={(n) => onChange({ start: n })} />
        <NumberField id={`${id}-e`} label="Until (seconds)" value={overlay.end} min={0} max={total} onCommit={(n) => onChange({ end: n })} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1"><label htmlFor={`${id}-p`} className="text-xs font-medium">Position</label>
          <Select id={`${id}-p`} className="h-9" value={overlay.position} onChange={(e) => onChange({ position: e.target.value as Overlay['position'] })}>{POSITIONS.map((v) => <option key={v} value={v}>{LABELS.position[v]}</option>)}</Select></div>
        <div className="space-y-1"><label htmlFor={`${id}-z`} className="text-xs font-medium">Size</label>
          <Select id={`${id}-z`} className="h-9" value={overlay.size} onChange={(e) => onChange({ size: e.target.value as Overlay['size'] })}>{SIZES.map((v) => <option key={v} value={v}>{LABELS.size[v]}</option>)}</Select></div>
        <div className="space-y-1"><label htmlFor={`${id}-c`} className="text-xs font-medium">Colour</label>
          <Select id={`${id}-c`} className="h-9" value={overlay.color} onChange={(e) => onChange({ color: e.target.value as Overlay['color'] })}>{COLORS.map((v) => <option key={v} value={v}>{LABELS.color[v]}</option>)}</Select></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={overlay.box} onChange={(e) => onChange({ box: e.target.checked })} /> Put a box behind the text (easier to read)</label>
      <Button size="sm" variant="outline" onClick={onRemove}><Trash2 aria-hidden="true" /> Remove text</Button>
    </section>
  );
}
