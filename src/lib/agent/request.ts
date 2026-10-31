/** Limits and cleaning for what the browser may send to the agent. Pure, so it is tested without a server. */

export const MESSAGE_MAX = 1000;
export const HISTORY_MAX_TURNS = 8;
export const HISTORY_TURN_CHARS = 1500;

export type Turn = { role: 'user' | 'assistant'; text: string };

/** Only plain text turns are accepted, clipped, and the list must start with a creator turn. */
export function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const out: Turn[] = [];
  for (const item of raw.slice(-HISTORY_MAX_TURNS)) {
    if (!item || typeof item !== 'object') continue;
    const { role, text } = item as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof text !== 'string' || text.trim() === '') continue;
    out.push({ role, text: text.slice(0, HISTORY_TURN_CHARS) });
  }
  while (out.length > 0 && out[0].role !== 'user') out.shift();
  return out;
}
