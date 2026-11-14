import { explainAiError } from './ai-errors';
import { emailsIn } from '../email-address';
import { draftOf } from './activity';
import { handoffHref } from './handoff';
import { collectNumbers, collectUserNumbers, numbersIn, scanText } from './validate';
import type { Block, ToolLlm, ToolMessage, ToolResultBlock, ToolUseBlock } from './tool-llm';
import { toolSchemas, toolByName, type ToolCtx, type ToolSpec } from './tools/specs';

/**
 * The agent loop. Pure: the model, the tools' real work and the action log are all injected, so the rules below
 * are tested with scripted fakes (tests/agent-runner.test.ts) and no network.
 *
 * What the loop enforces, in code (the prompt only asks nicely):
 *  - only tools in the registry can run, with validated arguments;
 *  - 'change' tools (changes to existing records, emails, posts) never run in the loop: they become pending approval
 *    cards, executed by the Approve button's server action from the stored card;
 *  - hard caps on steps, tool calls, created records and images per request, and a wall-clock deadline;
 *  - the final message is checked before the creator sees it, and replaced by a plain summary of what was
 *    actually done if it fails (invented figures, outcome promises, or claims of actions the agent cannot take).
 */

export const LIMITS = { steps: 10, toolCalls: 20, creates: 8, images: 2, renders: 1, changes: 8, searches: 3, deadlineMs: 240_000, resultChars: 7000, replyChars: 2500 } as const;

export type RecordRef = { kind: string; id: string; href: string };
export type DraftOut = { kind: string; title: string; body: string };

export type ToolRunResult =
  | { ok: true; text: string; record?: RecordRef; draft?: DraftOut; /** Small facts Undo needs later (for example the status before a change). Text values only. */ undo?: Record<string, string>; /** True once the server has read the made record back from the database and found it. */ verified?: true }
  | { ok: false; error: string };

/**
 * For 'change' tools: a read-only look at the world BEFORE the card is queued. It can refuse (the record does not exist,
 * Gmail is not connected), and it can fill in what only the server knows (the recipient's address from the deal) and write
 * the one-line summary the creator will read on the card. It never changes anything.
 */
export type ChangeCheck = { ok: true; args?: Record<string, unknown>; summary?: string } | { ok: false; error: string };

export type RuntimeTool = { spec: ToolSpec<any>; run(args: any): Promise<ToolRunResult>; check?(args: any): Promise<ChangeCheck> };

export type NewAction = { runId: string; tool: string; tier: 'create' | 'change'; status: 'done' | 'pending'; summary: string; args: Record<string, unknown>; result: Record<string, unknown> };
export interface ActionStore {
  /** Returns the new row's id, or null when the log could not be written (the work itself is not undone). */
  record(action: NewAction): Promise<string | null>;
}

export type ActionView = {
  id: string | null;
  tool: string;
  tier: 'create' | 'change';
  status: 'done' | 'pending' | 'failed';
  summary: string;
  href: string;
  record?: RecordRef;
  draft?: DraftOut;
  error?: string;
  /** The server read the made record back from the database and found it. */
  verified?: boolean;
};

export type Stopped = 'done' | 'step_limit' | 'deadline' | 'tool_limit' | 'ai_error';

export type RunResult =
  | { ok: true; reply: string; notice: string | null; actions: ActionView[]; stopped: Stopped; steps: number }
  | { ok: false; code: 'ai_unavailable' | 'ai_failed'; message: string; actions: ActionView[] };

export type RunInput = {
  llm: ToolLlm;
  system: string;
  tools: RuntimeTool[];
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  message: string;
  runId: string;
  store: ActionStore;
  now: () => number;
  /** Numbers that appear in the creator's data (counts, amounts). The model's reply may use these. */
  dataNumbers: Set<number>;
};

const AI_FAILURE: Record<string, string> = {
  not_configured: 'AI is not set up on this server (no AI key is set), so the agent cannot work yet. The daily review on the dashboard still works from rules.',
  timeout: 'The AI service took too long to answer.',
  network: 'The AI service could not be reached.',
  http_error: 'The AI service returned an error.',
  empty: 'The AI service returned an empty answer.',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Keep stored arguments inside the database's size limit by shortening the longest text fields. */
export function fitArgs(args: Record<string, unknown>, maxBytes = 7000): Record<string, unknown> {
  const copy: Record<string, unknown> = JSON.parse(JSON.stringify(args));
  const size = () => new TextEncoder().encode(JSON.stringify(copy)).length;
  for (let guard = 0; guard < 40 && size() > maxBytes; guard++) {
    let longest: string | null = null;
    for (const [k, v] of Object.entries(copy)) if (typeof v === 'string' && (longest === null || v.length > (copy[longest] as string).length)) longest = k;
    if (longest === null) return { truncated: true };
    const v = copy[longest] as string;
    copy[longest] = `${v.slice(0, Math.max(0, Math.floor(v.length / 2)))}…`;
  }
  return size() > maxBytes ? { truncated: true } : copy;
}

/* ── the reply check ───────────────────────────────────────────────────── */

/** Verbs the agent has no way to perform. Saying it did one of them is wrong, so the reply is replaced. */
const FALSE_CLAIM = /\b(?:i|i['’]ve|i have|we|we['’]ve|we have)\s+(?:just\s+|already\s+)?(?:published|posted|sent|emailed|scheduled|paid|deleted|removed|submitted|approved|uploaded|moved|marked|updated|changed|renamed|cancelled|canceled)\b/i;
const FIGURE_UNIT = /(?:^|[^\d.,])(\d[\d,]*(?:\.\d+)?)\s?(?:%|percent\b|views|likes|followers|subscribers|comments|shares|saves|clicks|impressions|reach|customers|clients|sales)/gi;
const CURRENCY = /[$€£]\s?(\d[\d,]*(?:\.\d+)?)/g;
const FREE_SMALL = 31;

/**
 * Reasons the reply must not be shown. A number is fine if it appears in the creator's data, in their message,
 * or in what a tool returned. Small whole numbers (counts like "3 drafts", dates) are allowed because the model
 * is describing its own work, but anything that reads as a result (%, views, followers, money) must be sourced.
 */
export function replyProblems(text: string, allowed: Set<number>): string[] {
  const reasons: string[] = [];
  if (text.trim().length === 0) reasons.push('the reply is empty');
  if (text.length > LIMITS.replyChars) reasons.push('the reply is too long');
  if (FALSE_CLAIM.test(text)) reasons.push('the reply says it did something the agent cannot do');
  const strict = scanText(text, new Set([...allowed, ...Array.from({ length: FREE_SMALL + 1 }, (_, i) => i)]), 'reply').filter((r) => !r.includes('unsupported number'));
  reasons.push(...strict);
  const checkFigure = (raw: string) => {
    const n = parseFloat(raw.replace(/,/g, ''));
    if (Number.isFinite(n) && !allowed.has(Math.round(n * 1e6) / 1e6)) reasons.push(`the reply contains a figure that is not in your data: ${raw}`);
  };
  for (const m of text.matchAll(FIGURE_UNIT)) checkFigure(m[1]);
  for (const m of text.matchAll(CURRENCY)) checkFigure(m[1]);
  for (const n of numbersIn(text)) {
    if (n > FREE_SMALL && !allowed.has(n) && !(n >= 2000 && n <= 2100)) reasons.push(`the reply contains a number that is not in your data: ${n}`);
  }
  return Array.from(new Set(reasons));
}

/** A reply built only from what was actually done, used when the model's own wording fails the check or never came. */
export function fallbackReply(actions: ActionView[], stopped: Stopped): string {
  const done = actions.filter((a) => a.status === 'done');
  const pending = actions.filter((a) => a.status === 'pending');
  const failed = actions.filter((a) => a.status === 'failed');
  const lines: string[] = [];
  if (done.length) lines.push(`Prepared ${done.length} ${done.length === 1 ? 'item' : 'items'}:`, ...done.map((a) => `• ${a.summary}`));
  if (pending.length) lines.push(`Waiting for your approval (nothing has been sent, posted or changed yet):`, ...pending.map((a) => `• ${a.summary}`));
  if (failed.length) lines.push(`Could not do:`, ...failed.map((a) => `• ${a.summary}${a.error ? `: ${a.error}` : ''}`));
  if (lines.length === 0) lines.push('I did not make or change anything.');
  if (stopped === 'step_limit' || stopped === 'tool_limit') lines.push('I stopped at my limit for one request. Ask again to continue.');
  if (stopped === 'deadline') lines.push('I ran out of time for one request. Ask again to continue.');
  if (stopped === 'ai_error') lines.push('The AI service stopped responding partway through, so I could not finish. Ask again to continue.');
  return lines.join('\n');
}

/* ── the loop ──────────────────────────────────────────────────────────── */

export async function runAgent(input: RunInput): Promise<RunResult> {
  const { llm, system, tools, runId, store } = input;
  const started = input.now();
  const registry = new Map<string, RuntimeTool>(tools.map((t) => [t.spec.name, t]));

  const userNumbers = new Set<number>();
  for (const h of input.history) if (h.role === 'user') collectUserNumbers(h.text, userNumbers);
  collectUserNumbers(input.message, userNumbers);
  const allowed = new Set<number>([...input.dataNumbers, ...userNumbers]);
  // Addresses the creator typed themselves. The only ones, besides a deal or inquiry contact, that an email may go to.
  const userEmails = new Set<string>();
  for (const h of input.history) if (h.role === 'user') emailsIn(h.text).forEach((e) => userEmails.add(e));
  emailsIn(input.message).forEach((e) => userEmails.add(e));
  const ctx: ToolCtx = { now: new Date(input.now()), userNumbers, allowedNumbers: allowed, userEmails };

  const messages: ToolMessage[] = [...input.history.map((h) => ({ role: h.role, content: h.text }) as ToolMessage), { role: 'user', content: input.message }];
  const actions: ActionView[] = [];
  const pendingKeys = new Set<string>();
  let toolCalls = 0;
  let creates = 0;
  let images = 0;
  let renders = 0;
  let changes = 0;
  let searches = 0;
  const readCache = new Map<string, string>();
  let steps = 0;
  let stopped: Stopped = 'done';
  let finalText = '';

  for (; steps < LIMITS.steps; ) {
    const remaining = LIMITS.deadlineMs - (input.now() - started);
    if (remaining < 4000) { stopped = 'deadline'; break; }
    const res = await llm({ system, messages, tools: toolSchemas(), maxTokens: 2000, timeoutMs: Math.min(40_000, remaining) });
    steps += 1;
    if (!res.ok) {
      if (actions.length > 0) { stopped = 'ai_error'; break; }
      return { ok: false, code: res.reason === 'not_configured' ? 'ai_unavailable' : 'ai_failed', message: `${(res.reason === 'http_error' ? explainAiError(res.detail) : null) ?? AI_FAILURE[res.reason] ?? 'The AI service failed.'} Nothing was changed.`, actions };
    }
    messages.push({ role: 'assistant', content: res.content });
    const uses = res.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
    if (uses.length === 0) {
      finalText = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n').trim();
      break;
    }

    const results: ToolResultBlock[] = [];
    for (const use of uses) {
      const out = await runOne(use);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: clip(out.text, LIMITS.resultChars), ...(out.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results as Block[] });
    if (toolCalls >= LIMITS.toolCalls) { stopped = 'tool_limit'; }
    if (steps >= LIMITS.steps && !finalText) stopped = 'step_limit';
  }
  if (finalText) stopped = 'done';
  else if (stopped === 'done') stopped = 'step_limit';

  // The reply: the model's own words if they pass the check, otherwise a plain account of what was done.
  let reply = finalText;
  let notice: string | null = null;
  if (finalText) {
    const problems = replyProblems(finalText, allowed);
    if (problems.length > 0) {
      reply = fallbackReply(actions, stopped);
      notice = 'The assistant’s own wording was replaced with a plain summary because it did not pass PBOS’s checks. The list below is exactly what happened.';
    }
  } else {
    reply = fallbackReply(actions, stopped);
  }
  return { ok: true, reply, notice, actions, stopped, steps };

  /** Runs a single tool call, applying the tier rules. Never throws. */
  async function runOne(use: ToolUseBlock): Promise<{ text: string; isError: boolean }> {
    const tool = registry.get(use.name);
    const spec = toolByName(use.name);
    if (!tool || !spec) return { text: `There is no tool called “${use.name}”. Use only the tools you were given.`, isError: true };
    if (toolCalls >= LIMITS.toolCalls) return { text: 'You have used all the tool calls allowed for one request. Stop and summarize what you did.', isError: true };
    toolCalls += 1;

    const parsed = spec.parse(use.input ?? {}, ctx);
    if (!parsed.ok) return { text: parsed.error, isError: true };
    const args = parsed.value as Record<string, unknown>;
    const summary = spec.summary(parsed.value);

    if (spec.tier === 'read') {
      // The same read twice in one request costs a round trip (and, for a search, money) and teaches nothing new.
      const cacheKey = `${spec.name}:${JSON.stringify(args)}`;
      const seen = readCache.get(cacheKey);
      if (seen !== undefined) return { text: `You already did this in this request. Same result:\n${seen}`, isError: false };
      if (spec.name === 'web_search') {
        if (searches >= LIMITS.searches) return { text: `You have used the ${LIMITS.searches} web searches allowed for one request. Work with what you found.`, isError: true };
        searches += 1;
      }
      const r = await safeRun(tool, args);
      if (!r.ok) return { text: r.error, isError: true };
      collectNumbers(r.text, allowed);
      readCache.set(cacheKey, clip(r.text, LIMITS.resultChars));
      return { text: r.text, isError: false };
    }

    if (spec.tier === 'change') {
      if (changes >= LIMITS.changes) return { text: 'Too many requests are already waiting for approval in this request. Summarize them for the creator instead.', isError: true };
      // Look before queueing: refuse what could never be approved, and let the server fill in what only it knows.
      let storedArgs = args;
      let cardSummary = summary;
      if (tool.check) {
        const checked = await safeCheck(tool, args);
        if (!checked.ok) return { text: checked.error, isError: true };
        if (checked.args) {
          const again = spec.parse(checked.args, { ...ctx, stored: true });
          if (!again.ok) return { text: `That request could not be prepared: ${again.error}`, isError: true };
          storedArgs = again.value as Record<string, unknown>;
        }
        if (checked.summary) cardSummary = checked.summary.slice(0, 400);
      }
      const key = `${spec.name}:${JSON.stringify(storedArgs)}`;
      if (pendingKeys.has(key)) return { text: 'That is already waiting for the creator’s approval.', isError: false };
      pendingKeys.add(key);
      changes += 1;
      const id = await store.record({ runId, tool: spec.name, tier: 'change', status: 'pending', summary: cardSummary, args: fitArgs(storedArgs), result: {} });
      actions.push({ id, tool: spec.name, tier: 'change', status: 'pending', summary: cardSummary, href: spec.href, draft: draftOf({ tool: spec.name, args: storedArgs, status: 'pending' }) });
      return { text: `Queued for the creator’s approval${id ? '' : ' (the approval log could not be written, so tell the creator to repeat the request)'}. NOTHING has been changed, sent or posted yet. Tell the creator it is waiting for them to press Approve.`, isError: false };
    }

    // create
    if (creates >= LIMITS.creates) return { text: 'You have reached the limit of new items for one request. Summarize what you made.', isError: true };
    if (spec.name === 'generate_image' && images >= LIMITS.images) return { text: `At most ${LIMITS.images} images per request. Use the ones already made.`, isError: true };
    if (spec.name === 'render_edit' && renders >= LIMITS.renders) return { text: 'Only one video can be rendered per request. Tell the creator the first one is done and offer to make another.', isError: true };
    const r = await safeRun(tool, args);
    if (!r.ok) {
      actions.push({ id: null, tool: spec.name, tier: 'create', status: 'failed', summary, href: spec.href, error: r.error });
      return { text: r.error, isError: true };
    }
    creates += 1;
    if (spec.name === 'generate_image') images += 1;
    if (spec.name === 'render_edit') renders += 1;
    const result: Record<string, unknown> = r.record ? { ...r.record } : {};
    if (r.undo) result.undo = r.undo;
    if (r.draft) result.draft = true;
    if (r.verified) result.verified = true;
    const id = await store.record({ runId, tool: spec.name, tier: 'create', status: 'done', summary, args: fitArgs(args), result });
    actions.push({ id, tool: spec.name, tier: 'create', status: 'done', summary, href: handoffHref(spec.name, id, r.record?.href ?? spec.href), record: r.record, draft: r.draft, verified: r.verified });
    collectNumbers(r.text, allowed);
    return { text: r.text, isError: false };
  }
}

async function safeCheck(tool: RuntimeTool, args: Record<string, unknown>): Promise<ChangeCheck> {
  try {
    return await (tool.check as NonNullable<RuntimeTool['check']>)(args);
  } catch (err) {
    console.error(`[agent] check for ${tool.spec.name} threw:`, err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'That could not be checked on the server right now. Nothing was queued.' };
  }
}

async function safeRun(tool: RuntimeTool, args: Record<string, unknown>): Promise<ToolRunResult> {
  try {
    return await tool.run(args);
  } catch (err) {
    console.error(`[agent] tool ${tool.spec.name} threw:`, err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: 'That step failed on the server. Nothing was changed.' };
  }
}
