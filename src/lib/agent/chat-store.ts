/**
 * The agent chat's memory. Pure data rules only (no React, no browser globals), so they are tested.
 *
 * The conversation used to live inside the page component, so it vanished whenever the creator opened another tab. It now
 * lives in a store that outlives the page (see src/components/agent-chat-store.ts) and is saved in this browser. Everything
 * read back is validated and capped, because browser storage is just text anyone can edit.
 */

export type StoredMessage = { id: string; role: 'user' | 'agent'; text: string; itemIds: string[]; notice?: string | null; error?: boolean };
export type StoredTurn = { role: 'user' | 'assistant'; text: string };
export type StoredChat = { v: 1; messages: StoredMessage[]; turns: StoredTurn[]; draft: string };

export const CHAT_LIMITS = { messages: 40, textMax: 6000, turns: 8, itemIds: 20, draft: 4000 } as const;
export const chatKey = (owner: string) => `pbos-agent-chat:${owner}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Ids of cards: a stored action id, or one the app made for this page load ("local-…"). */
const ID = /^(local-)?[0-9a-zA-Z_-]{1,64}$/;

export function parseChat(raw: unknown): StoredChat | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > 400_000) return null;
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!isObj(data) || data.v !== 1 || !Array.isArray(data.messages) || !Array.isArray(data.turns)) return null;
  const messages: StoredMessage[] = [];
  for (const m of data.messages) {
    if (!isObj(m)) continue;
    if (typeof m.id !== 'string' || !ID.test(m.id) || (m.role !== 'user' && m.role !== 'agent') || typeof m.text !== 'string') continue;
    const itemIds = Array.isArray(m.itemIds) ? m.itemIds.filter((x): x is string => typeof x === 'string' && (UUID.test(x) || ID.test(x))).slice(0, CHAT_LIMITS.itemIds) : [];
    messages.push({ id: m.id, role: m.role, text: m.text.slice(0, CHAT_LIMITS.textMax), itemIds, notice: typeof m.notice === 'string' ? m.notice.slice(0, 400) : null, error: m.error === true });
  }
  const turns: StoredTurn[] = [];
  for (const t of data.turns) {
    if (isObj(t) && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string') turns.push({ role: t.role, text: t.text.slice(0, CHAT_LIMITS.textMax) });
  }
  return { v: 1, messages: messages.slice(-CHAT_LIMITS.messages), turns: turns.slice(-CHAT_LIMITS.turns), draft: typeof data.draft === 'string' ? data.draft.slice(0, CHAT_LIMITS.draft) : '' };
}

export function serializeChat(chat: Omit<StoredChat, 'v'>): string {
  return JSON.stringify({
    v: 1,
    messages: chat.messages.slice(-CHAT_LIMITS.messages).map((m) => ({ ...m, text: m.text.slice(0, CHAT_LIMITS.textMax) })),
    turns: chat.turns.slice(-CHAT_LIMITS.turns),
    draft: chat.draft.slice(0, CHAT_LIMITS.draft),
  } satisfies StoredChat);
}

/** If the page was reloaded while a request was running, the saved chat ends on the creator's own message with no answer. */
export const INTERRUPTED_NOTE = 'The page was reloaded before I could answer that. Anything I finished is listed under “Earlier activity”. Ask again if something is missing.';
export function withInterruptedNote(messages: StoredMessage[]): StoredMessage[] {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') return [...messages, { id: `a-${last.id}`, role: 'agent', text: INTERRUPTED_NOTE, itemIds: [], error: true }];
  return messages;
}

/** What the agent says in the chat after the creator allows or denies a card. */
export function decisionMessage(decision: 'allowed' | 'denied', summary: string, result: string | undefined): string {
  if (decision === 'denied') return `Denied. I did not do this: ${summary}`;
  return `Allowed and done. ${result ?? summary}`.trim();
}
