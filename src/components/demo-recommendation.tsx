'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

/** Accept / Ignore on a sample recommendation. Held in the browser only: the demo stores nothing. */
export function DemoRecommendation({ pillar, action, reason, sources }: { pillar: string; action: string; reason: string; sources: Array<{ label: string; anchor: string }> }) {
  const [decision, setDecision] = useState<'accepted' | 'ignored' | null>(null);
  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>{pillar}</Badge>
        {decision ? <Badge variant={decision === 'accepted' ? 'success' : 'secondary'}>{decision === 'accepted' ? 'Accepted' : 'Ignored'}</Badge> : null}
      </div>
      <p className="font-serif text-lg leading-snug">{action}</p>
      <p className="text-sm leading-relaxed text-muted-foreground"><span className="font-medium text-foreground">Why: </span>{reason}</p>
      <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Source data: </span>{sources.map((s, i) => <span key={s.label}>{i > 0 ? ' · ' : ''}<a className="underline" href={s.anchor}>{s.label}</a></span>)}</p>
      {decision ? (
        <p className="text-xs text-muted-foreground">In your own workspace this choice is saved, and PBOS stops raising a suggestion you ignore twice.</p>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDecision('accepted')}>Accept</Button>
          <Button size="sm" variant="ghost" onClick={() => setDecision('ignored')}>Ignore</Button>
        </div>
      )}
    </li>
  );
}
