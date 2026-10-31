'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

/**
 * A number box that lets you type freely (“1.”, “”, “-”) and only commits a finished value, on blur or Enter.
 * The visible label is a real <label>, so the field has an accessible name.
 */
export function NumberField({ id, label, value, min, max, step = 0.1, onCommit, suffix = 's', hint }: {
  id: string; label: string; value: number; min?: number; max?: number; step?: number; onCommit: (n: number) => void; suffix?: string; hint?: string;
}) {
  const fmt = (n: number) => String(Math.round(n * 100) / 100);
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const n = Number.parseFloat(text.replace(',', '.'));
    if (Number.isFinite(n)) onCommit(n);
    else setText(fmt(value));
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-medium">{label}</label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          className="h-9 w-24"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <span className="text-xs text-muted-foreground" aria-hidden="true">{suffix}</span>
      </div>
      {hint ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
