'use client';

import { clipLength, formatTime, type Project } from '@/lib/studio/edl';
import { cn } from '@/lib/utils';

export type Selection = { kind: 'clip' | 'text'; id: string } | null;

/**
 * The edit as two lists the keyboard and screen readers can walk: clips in order, then text. Clip buttons are
 * sized by length so the strip also reads as a timeline for sighted users, but the meaning is in the labels.
 */
export function StudioTimeline({ project, selection, onSelect, playhead }: { project: Project; selection: Selection; onSelect: (s: Selection) => void; playhead: number }) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="timeline-clips-h" className="space-y-2">
        <h2 id="timeline-clips-h" className="font-serif text-lg">Timeline</h2>
        {project.clips.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing here yet. Add a video to start.</p>
        ) : (
          <ol className="flex gap-1 overflow-x-auto pb-1" aria-label="Clips in order">
            {project.clips.map((c, i) => {
              const picked = selection?.kind === 'clip' && selection.id === c.id;
              return (
                <li key={c.id} style={{ flexGrow: Math.max(clipLength(c), 1) }} className="min-w-[6.5rem]">
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'clip', id: c.id })}
                    aria-pressed={picked}
                    className={cn('flex h-full w-full flex-col items-start gap-0.5 rounded-md border p-2 text-left text-xs transition-colors', picked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent')}
                  >
                    <span className="font-medium">Clip {i + 1}</span>
                    <span className="w-full truncate text-muted-foreground">{c.label}</span>
                    <span className="tabular text-muted-foreground">{formatTime(clipLength(c))}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {project.clips.length > 0 ? <p className="tabular text-xs text-muted-foreground">Playhead at {formatTime(playhead)}.</p> : null}
      </section>

      <section aria-labelledby="timeline-text-h" className="space-y-2">
        <h3 id="timeline-text-h" className="text-sm font-medium">Text on screen</h3>
        {project.overlays.length === 0 ? (
          <p className="text-sm text-muted-foreground">No text yet. Use “Add text” to put words on the picture at the playhead.</p>
        ) : (
          <ul className="space-y-1" aria-label="Text overlays">
            {project.overlays.map((o) => {
              const picked = selection?.kind === 'text' && selection.id === o.id;
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: 'text', id: o.id })}
                    aria-pressed={picked}
                    className={cn('flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors', picked ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-accent')}
                  >
                    <span className="truncate">“{o.text || '(empty)'}”</span>
                    <span className="tabular shrink-0 text-xs text-muted-foreground">{formatTime(o.start)} to {formatTime(o.end)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
