'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { CopyButton } from '@/components/copy-button';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { approveAgentAction, dismissAgentAction, undoAgentAction } from '@/actions/agent-actions';
import { viewToFeedItem, type FeedItem } from '@/lib/agent/activity';
import { MESSAGE_MAX, type Turn } from '@/lib/agent/request';
import type { ActionView } from '@/lib/agent/runner';

const EXAMPLES = [
  'Plan my next week of content from my ideas.',
  'Write a script for my newest idea that has none.',
  'Email the contact on the deal that has sat longest with a short follow-up.',
  'Make a private Instagram draft from my best idea and queue it for approval.',
  'Search the web for what changed in YouTube Shorts rules this year.',
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

type ChatMessage = { id: string; role: 'user' | 'agent'; text: string; itemIds: string[]; notice?: string | null; error?: boolean };

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'agent',
  text: 'Hi, I’m your agent. Tell me what to do and I’ll read your workspace and get it done. Drafts, ideas, images and ad copy I make myself. Anything that sends an email, posts, or changes something that already exists comes back here as a card, and only goes ahead when you press Approve.',
  itemIds: [],
};

/** One thing the agent made or proposed, with Approve, Dismiss and Undo as the creator's own buttons. */
function ActionCard({ item, highlight, settle }: { item: FeedItem; highlight?: boolean; settle: (id: string, status: FeedItem['status']) => void }) {
  return (
    <div className={`rounded-lg border bg-background p-3 ${highlight ? 'border-primary/50' : 'border-border'}`}>
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant={STATUS[item.status].variant}>{STATUS[item.status].label}</Badge>
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{item.summary}</p>
      </div>
      {item.error ? <p className="mt-2 text-sm text-destructive">{item.error}</p> : null}
      {item.note ? <p className="mt-2 text-sm text-muted-foreground">{item.note}</p> : null}
      {item.status === 'pending' ? <p className="mt-2 text-xs text-muted-foreground">{item.tool === 'send_email' || item.tool === 'publish_post' ? 'Nothing has been sent or posted yet. It happens only if you approve.' : 'Nothing has changed yet. It happens only if you approve.'}</p> : null}
      {item.verified ? <p className="mt-2 text-xs text-muted-foreground">{item.tier === 'change' ? 'Checked: the change was read back from your workspace and matches what you approved.' : 'Checked: this was found in your workspace after it was made.'}</p> : null}
      {item.draft ? (
        <div className="mt-3 rounded-md border border-border bg-card p-3">
          <p className="text-xs font-medium text-muted-foreground">{item.tool === 'send_email' ? `Email · ${item.draft.title}` : `${item.draft.kind[0].toUpperCase()}${item.draft.kind.slice(1)} draft · ${item.draft.title}`}</p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.draft.body}</p>
          {item.tool === 'send_email' ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {item.status === 'pending' ? 'AI-written. This exact text is sent from your Gmail only if you press Approve. Dismiss it to send nothing.' : item.status === 'approved' ? 'This was sent from your Gmail.' : 'This was not sent.'}
            </p>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">AI-written. Read and edit it before you use it. PBOS never sends it.</p>
          )}
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
    </div>
  );
}

/**
 * The agent as a chat. You write what you want; the agent answers in the thread, and anything it made or needs your
 * approval for appears as a card inside its reply. Approve, Dismiss and Undo are the creator's own buttons: they call
 * server actions that act on the stored row, not on anything this component holds.
 */
export function AgentWorkspace({ aiReady, initialFeed }: { aiReady: boolean; initialFeed: FeedItem[] }) {
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>(initialFeed);
  const [latestRun, setLatestRun] = useState<string | null>(null);
  // Requests still waiting from earlier sessions are shown inside the first agent message, so nothing is missed.
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const waiting = initialFeed.filter((x) => x.canApprove).map((x) => x.id);
    return [waiting.length > 0 ? { ...GREETING, text: `${GREETING.text}\n\n${waiting.length === 1 ? 'One request is' : `${waiting.length} requests are`} still waiting for your approval from earlier:`, itemIds: waiting } : GREETING];
  });
  const busy = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  async function send(raw: string) {
    const message = raw.trim();
    if (busy.current || message.length < 3) return;
    busy.current = true;
    setPending(true);
    setText('');
    const stamp0 = Date.now();
    setMessages((m) => [...m, { id: `u-${stamp0}`, role: 'user', text: message, itemIds: [] }]);
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
        setMessages((m) => [...m, { id: `a-${stamp0}`, role: 'agent', text: body.error ?? 'I could not finish that. Please try again.', itemIds: made.map((x) => x.id), error: true }]);
        setText(message);
        return;
      }
      setTurns((t) => [...t, { role: 'user', text: message }, { role: 'assistant', text: body.reply as string }].slice(-8) as Turn[]);
      setMessages((m) => [...m, { id: `a-${stamp0}`, role: 'agent', text: body.reply as string, itemIds: made.map((x) => x.id), notice: body.notice ?? null }]);
    } catch {
      setMessages((m) => [...m, { id: `a-${stamp0}`, role: 'agent', text: 'I could not reach the server. Check your connection and try again.', itemIds: [], error: true }]);
      setText(message);
    } finally {
      busy.current = false;
      setPending(false);
      field.current?.focus();
    }
  }

  function settle(id: string, status: FeedItem['status']) {
    setFeed((f) => f.map((x) => (x.id === id ? { ...x, status, canApprove: false, canUndo: false } : x)));
  }

  const shownIds = new Set(messages.flatMap((m) => m.itemIds));
  const earlier = feed.filter((x) => !shownIds.has(x.id));
  const waitingNow = feed.filter((x) => x.canApprove).length;
  const fresh = messages.length <= 1;

  return (
    <div className="flex flex-col gap-3">
      {!aiReady ? <Alert variant="info" title="The agent needs the AI key">This deployment has no AI key yet (set AI_API_KEY; a free Google Gemini key works). The daily review on the dashboard still works from rules.</Alert> : null}

      <div className="flex h-[72vh] min-h-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium">Chat with your agent</p>
          {waitingNow > 0 ? <Badge variant="warning">{waitingNow} waiting for your approval</Badge> : <span className="text-xs text-muted-foreground">Nothing waiting for you</span>}
        </div>

        <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-4 py-4" role="log" aria-live="polite" aria-label="Conversation with the agent">
          {earlier.length > 0 ? (
            <details className="rounded-lg border border-border bg-background px-3 py-2 text-sm">
              <summary className="cursor-pointer text-muted-foreground">Earlier activity ({earlier.length})</summary>
              <div className="mt-3 space-y-3">
                {earlier.map((item) => <ActionCard key={item.id} item={item} settle={settle} />)}
              </div>
            </details>
          ) : null}

          {messages.map((m) => {
            const items = m.itemIds.map((id) => feed.find((x) => x.id === id)).filter((x): x is FeedItem => Boolean(x));
            return m.role === 'user' ? (
              <div key={m.id} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">{m.text}</p>
              </div>
            ) : (
              <div key={m.id} className="flex max-w-[92%] flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">Agent</p>
                <div className={`space-y-3 rounded-2xl rounded-bl-md border px-4 py-3 ${m.error ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-secondary'}`}>
                  <p className="whitespace-pre-line text-sm leading-relaxed">{m.text}</p>
                  {m.notice ? <p className="text-xs text-muted-foreground">{m.notice}</p> : null}
                  {items.map((item) => <ActionCard key={item.id} item={item} highlight={item.runId === latestRun} settle={settle} />)}
                </div>
              </div>
            );
          })}

          {pending ? (
            <div className="flex max-w-[92%] flex-col gap-2" role="status">
              <p className="text-xs font-medium text-muted-foreground">Agent</p>
              <p className="w-fit rounded-2xl rounded-bl-md border border-border bg-secondary px-4 py-3 text-sm text-muted-foreground">Working on it… this can take up to a minute.</p>
            </div>
          ) : null}
        </div>

        <div className="border-t border-border p-3">
          {fresh && !pending ? (
            <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Example requests">
              {EXAMPLES.map((x) => (
                <button key={x} type="button" className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground" onClick={() => { setText(x); field.current?.focus(); }}>{x}</button>
              ))}
            </div>
          ) : null}
          <form onSubmit={(e) => { e.preventDefault(); void send(text); }} className="flex items-end gap-2">
            <label htmlFor="agent-input" className="sr-only">Message the agent</label>
            <textarea
              ref={field}
              id="agent-input"
              rows={1}
              maxLength={MESSAGE_MAX}
              value={text}
              onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(e.currentTarget.scrollHeight, 160)}px`; }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }}
              placeholder={aiReady ? 'Tell the agent what to do…' : 'The agent needs the AI key first'}
              disabled={!aiReady}
              className="max-h-40 min-h-[2.75rem] flex-1 resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={!aiReady || pending || text.trim().length < 3}
              aria-label={pending ? 'Working' : 'Send'}
              aria-busy={pending}
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send aria-hidden="true" className="size-4" />
            </button>
          </form>
          <p className="mt-2 text-[0.7rem] text-muted-foreground">Enter to send, Shift + Enter for a new line. Nothing is sent, posted or changed until you approve it.</p>
        </div>
      </div>
    </div>
  );
}
