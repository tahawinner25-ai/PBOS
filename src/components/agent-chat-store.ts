'use client';

import { useSyncExternalStore } from 'react';
import { CHAT_LIMITS, chatKey, parseChat, serializeChat, withInterruptedNote, type StoredMessage, type StoredTurn } from '@/lib/agent/chat-store';
import { viewToFeedItem, type FeedItem } from '@/lib/agent/activity';
import type { ActionView } from '@/lib/agent/runner';

/**
 * The chat lives here, outside the React page, so that:
 *  - opening another tab and coming back shows the same conversation (the module stays alive while the app is open),
 *  - a request that is still running keeps going and its answer is kept when it arrives, even if the page is gone,
 *  - a reload restores the conversation from this browser's storage (validated on the way in).
 */

type RunResponse = { runId?: string; reply?: string; notice?: string | null; actions?: ActionView[]; error?: string };
type State = { owner: string | null; messages: StoredMessage[]; turns: StoredTurn[]; draft: string; pending: boolean; latestRun: string | null; made: FeedItem[]; ready: boolean };

let state: State = { owner: null, messages: [], turns: [], draft: '', pending: false, latestRun: null, made: [], ready: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Partial<State>) => { state = { ...state, ...next }; emit(); };
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function save() {
  if (!state.owner) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { window.localStorage.setItem(chatKey(state.owner as string), serializeChat({ messages: state.messages, turns: state.turns, draft: state.draft })); } catch { /* storage can be blocked: the chat then lasts while the app is open */ }
  }, 300);
}

/** Called by the page on mount. A different creator on the same browser never sees another's chat. */
export function openChat(owner: string, greeting: (waiting: string[]) => StoredMessage, waiting: string[]) {
  if (state.owner === owner && state.ready) return;
  let restored: ReturnType<typeof parseChat> = null;
  try { restored = parseChat(window.localStorage.getItem(chatKey(owner))); } catch { restored = null; }
  const messages = restored && restored.messages.length > 0 ? withInterruptedNote(restored.messages) : [greeting(waiting)];
  state = { owner, messages, turns: restored?.turns ?? [], draft: restored?.draft ?? '', pending: false, latestRun: null, made: [], ready: true };
  emit();
}

export function useChat(): State {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state, () => state);
}

export function setDraft(draft: string) { set({ draft: draft.slice(0, CHAT_LIMITS.draft) }); save(); }

export function addAgentMessage(text: string, itemIds: string[] = [], error = false) {
  const next: StoredMessage = { id: `a-${Date.now()}-${state.messages.length}`, role: 'agent', text, itemIds, error };
  set({ messages: [...state.messages, next].slice(-CHAT_LIMITS.messages) });
  save();
}

export async function sendMessage(raw: string): Promise<void> {
  const message = raw.trim();
  if (state.pending || message.length < 3) return;
  const stamp0 = Date.now();
  const history = state.turns;
  const mine: StoredMessage = { id: `u-${stamp0}`, role: 'user', text: message, itemIds: [] };
  set({ pending: true, draft: '', messages: [...state.messages, mine].slice(-CHAT_LIMITS.messages) });
  save();
  const add = (m: StoredMessage) => { set({ messages: [...state.messages, m].slice(-CHAT_LIMITS.messages) }); save(); };
  try {
    const res = await fetch('/api/agent/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, history }) });
    const body = (await res.json().catch(() => ({}))) as RunResponse;
    const stamp = new Date().toISOString();
    const made = (body.actions ?? []).map((a, i) => viewToFeedItem(a, body.runId ?? 'run', stamp, i));
    if (made.length > 0) set({ made: [...made, ...state.made.filter((x) => !made.some((m) => m.id === x.id))], latestRun: body.runId ?? null });
    if (!res.ok || typeof body.reply !== 'string') {
      add({ id: `a-${stamp0}`, role: 'agent', text: body.error ?? 'I could not finish that. Please try again.', itemIds: made.map((x) => x.id), error: true });
      set({ draft: message });
      return;
    }
    set({ turns: [...state.turns, { role: 'user', text: message }, { role: 'assistant', text: body.reply }].slice(-CHAT_LIMITS.turns) as StoredTurn[] });
    add({ id: `a-${stamp0}`, role: 'agent', text: body.reply, itemIds: made.map((x) => x.id), notice: body.notice ?? null });
  } catch {
    add({ id: `a-${stamp0}`, role: 'agent', text: 'I could not reach the server. Check your connection and try again.', itemIds: [], error: true });
    set({ draft: message });
  } finally {
    set({ pending: false });
  }
}

export function clearChat() {
  if (!state.owner) return;
  try { window.localStorage.removeItem(chatKey(state.owner)); } catch { /* ignore */ }
  state = { ...state, ready: false, messages: [], turns: [], draft: '', made: [] };
  emit();
}
