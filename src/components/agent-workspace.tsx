'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { ActionButton } from '@/components/action-button';
import { CopyButton } from '@/components/copy-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { approveAgentAction, dismissAgentAction, undoAgentAction } from '@/actions/agent-actions';
import { viewToFeedItem, type FeedItem } from '@/lib/agent/activity';
import { MESSAGE_MAX, type Turn } from '@/lib/agent/request';
import type { ActionView } from '@/lib/agent/runner';

const EXAMPLES = [
  'Plan my next week of content from my ideas.',
  'Write a script for my newest idea that has none.',
  'Draft a follow-up for the deal that has sat longest.',
  'Make a private Instagram draft from my best idea.',
];

type RunResponse = { runId?: string; reply?: string; notice?: string | null; actions?: ActionView[]; error?: string };

const STATUS: Record<FeedItem['status'], { label: string; variant: 'default' | 'success' | 'warning' | 'destructive' | 'outline' }> = {
  done: { label: 'Made', variant: 'success' },
  pending: { label: 'Needs your approval', variant: 'warning' },
  approved: { label: 'Approved and applied', variant: 'success' },
  dismissed: { label: 'Dismissed, nothing changed', variant: 'outline' },
  failed: { label: 'Not applied', variant: 'destructive' },
  undone: { label: 'Undone', variant: 'outline' },
};

/**
 * Talk to the agent and review what it did. The agent makes drafts on its own (each can be undone) and asks
 * before changing anything that already exists. Approve, Dismiss and Undo are the creator's own buttons: they
 * call server actions that act on the stored row, not on anything this component holds.
 */
export function AgentWorkspace({ aiReady, initialFeed }: { aiReady: boolean; initialFeed: FeedItem[] }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [feed, setFeed] = useState<FeedItem[]>(initialFeed);
  const [latestRun, setLatestRun] = useState<string | null>(null);
  const busy = useRef(false);

  async function send(raw: string) {
    const message = raw.trim();
    if (busy.current || message.length < 3) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/agent/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, history: turns }) });
      const body = (await res.json().catch(() => ({}))) as RunResponse;
      const stamp = new Date().toISOString();
      const made = (body.actions ?? []).map((a, i) => viewToFeedItem(a, body.runId ?? 'run', stamp, i));
      if (made.length > 0) {
        setFeed((f) => [...made, ...f.filter((x) => !made.some((m) => m.id === x.id))]);
        setLatestRun(body.runId ?? null);
      }
      if (!res.ok || typeof body.reply !== 'string') {
        setError(body.error ?? 'The agent could not finish. Try again.');
        return;
      }
      setTurns((t) => [...t, { role: 'user', text: message }, { role: 'assistant', text: body.reply as string }].slice(-8) as Turn[]);
      setNotice(body.notice ?? null);
      setText('');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function settle(id: string, status: FeedItem['status']) {
    setFeed((f) => f.map((x) => (x.id === id ? { ...x, status, canApprove: false, canUndo: false } : x)));
  }

  const lastReply = [...turns].reverse().find((t) => t.role === 'assistant');
  const waiting = feed.filter((x) => x.canApprove);

  return (
    <div className="space-y-8">
      {!aiReady ? <Alert variant="info" title="The agent needs the AI key">This deployment has no AI key yet (ANTHROPIC_API_KEY). The daily review on the dashboard still works from rules.</Alert> : null}

      <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="space-y-3" aria-describedby="agent-help">
        <label htmlFor="agent-input" className="text-sm font-medium">What should the agent do?</label>
        <Textarea
          id="agent-input"
          rows={3}
          maxLength={MESSAGE_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void send(text); } }}
          placeholder="For example: write a script for my newest idea, then draft a private Instagram post from it."
          disabled={!aiReady}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={!aiReady || pending || text.trim().length < 3} aria-busy={pending}>{pending ? 'Working…' : 'Send to the agent'}</Button>
          <span className="text-xs text-muted-foreground" aria-hidden="true">Ctrl or Cmd + Enter</span>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Example requests">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:bg-accent/50" onClick={() => setText(x)}>{x}</button>
          ))}
        </div>
        <p id="agent-help" className="text-xs text-muted-foreground">
          The agent can read your workspace and make new drafts, ideas, images and ad copy. Changes to anything that already exists wait for your Approve. It cannot publish, send, pay or delete. A request can take up to a minute.
        </p>
      </form>

      <div aria-live="polite" aria-atomic="false" className="space-y-3">
        {pending ? <p className="text-sm text-muted-foreground" role="status">The agent is working. Anything it makes appears below as soon as it is done.</p> : null}
        {error ? <Alert variant="destructive" title={error} /> : null}
        {notice ? <Alert variant="warning" title="Wording replaced">{notice}</Alert> : null}
        {lastReply && !pending ? (
          <section aria-label="The agent’s reply" className="rounded-lg border border-border bg-card p-4">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Agent</p>
            <p className="whitespace-pre-line text-sm leading-relaxed">{lastReply.text}</p>
          </section>
        ) : null}
      </div>

      {waiting.length > 0 ? (
        <Alert variant="warning" title={`${waiting.length} ${waiting.length === 1 ? 'change is' : 'changes are'} waiting for your approval`}>
          Nothing has been changed yet. Approve or dismiss each one below.
        </Alert>
      ) : null}

      <section aria-labelledby="activity-title" className="space-y-3">
        <h3 id="activity-title" className="font-serif text-lg">Activity</h3>
        {feed.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet. When the agent makes or proposes something, it is listed here, newest first.</p>
        ) : (
          <ul className="space-y-3">
            {feed.map((item) => (
              <li key={item.id} className={`rounded-lg border bg-card p-4 ${item.runId === latestRun ? 'border-primary/50' : 'border-border'}`}>
                <div className="flex flex-wrap items-start gap-2">
                  <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>
                  <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.summary}</p>
                </div>
                {item.error ? <p className="mt-2 text-sm text-destructive">{item.error}</p> : null}
                {item.note ? <p className="mt-2 text-sm text-muted-foreground">{item.note}</p> : null}
                {item.status === 'pending' ? <p className="mt-2 text-xs text-muted-foreground">Nothing has changed yet. It happens only if you approve.</p> : null}
                {item.verified ? <p className="mt-2 text-xs text-muted-foreground">{item.tier === 'change' ? 'Checked: the change was read back from your workspace and matches what you approved.' : 'Checked: this was found in your workspace after it was made.'}</p> : null}
                {item.draft ? (
                  <div className="mt-3 rounded-md border border-border bg-background p-3">
                    <p className="text-xs font-medium text-muted-foreground">{item.draft.kind[0].toUpperCase()}{item.draft.kind.slice(1)} draft · {item.draft.title}</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.draft.body}</p>
                    <p className="mt-2 text-xs text-muted-foreground">AI-written. Read and edit it before you use it. PBOS never sends it.</p>
                    <div className="mt-2"><CopyButton text={item.draft.body} label="Copy text" aria-label={`Copy the ${item.draft.kind} draft: ${item.draft.title}`} /></div>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {item.canApprove ? (
                    <>
                      <ActionButton size="sm" action={approveAgentAction.bind(null, item.id)} pendingLabel="Applying…" aria-label={`Approve: ${item.summary}`} onSuccess={() => settle(item.id, 'approved')}>Approve</ActionButton>
                      <ActionButton size="sm" variant="outline" action={dismissAgentAction.bind(null, item.id)} pendingLabel="Dismissing…" aria-label={`Dismiss: ${item.summary}`} onSuccess={() => settle(item.id, 'dismissed')}>Dismiss</ActionButton>
                    </>
                  ) : null}
                  {item.canUndo ? (
                    <ActionButton size="sm" variant="outline" action={undoAgentAction.bind(null, item.id)} pendingLabel="Undoing…" confirm="Undo this? The item the agent made will be removed." aria-label={`Undo: ${item.summary}`} onSuccess={() => settle(item.id, 'undone')}>Undo</ActionButton>
                  ) : null}
                  {item.status !== 'undone' && item.status !== 'dismissed' && !item.id.startsWith('local-') ? (
                    <Link href={item.record?.href ?? item.href} className="text-sm underline underline-offset-2">Open {(item.record?.href ?? item.href).replace('/', '') || 'page'}</Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
