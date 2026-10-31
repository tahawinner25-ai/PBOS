import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIMITS, fallbackReply, fitArgs, replyProblems, runAgent, type ActionStore, type NewAction, type RunInput, type RuntimeTool, type ToolRunResult } from '../src/lib/agent/runner';
import type { ToolLlm, ToolLlmResult, ToolMessage } from '../src/lib/agent/tool-llm';
import { TOOLS, toolByName } from '../src/lib/agent/tools/specs';

const ID1 = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
const POST = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';

type Step = ToolLlmResult;
const use = (name: string, input: unknown, id = `tu_${Math.random().toString(36).slice(2)}`): Step => ({ ok: true, stopReason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const say = (text: string): Step => ({ ok: true, stopReason: 'end_turn', content: [{ type: 'text', text }] });

/** A scripted model: returns the steps in order and remembers what it was shown at each turn. */
function scripted(steps: Step[]) {
  const seen: ToolMessage[][] = [];
  let i = 0;
  const llm: ToolLlm = async ({ messages }) => {
    seen.push(JSON.parse(JSON.stringify(messages)));
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    return step;
  };
  return { llm, seen, calls: () => i };
}

function tool(name: string, run: (args: any) => Promise<ToolRunResult>): RuntimeTool & { runs: unknown[] } {
  const spec = toolByName(name);
  assert.ok(spec, `unknown tool ${name}`);
  const runs: unknown[] = [];
  return { spec: spec!, runs, run: async (a) => { runs.push(a); return run(a); } };
}

function memoryStore() {
  const rows: NewAction[] = [];
  const store: ActionStore = { record: async (a) => { rows.push(a); return `row-${rows.length}`; } };
  return { store, rows };
}

const okText = (text: string): ToolRunResult => ({ ok: true, text });
const idea = (id = ID1): ToolRunResult => ({ ok: true, text: JSON.stringify({ created: 'idea', id }), record: { kind: 'idea', id, href: '/ideas' } });

function base(over: Partial<RunInput> & { steps: Step[]; tools?: RuntimeTool[] }): { input: RunInput; rows: NewAction[]; seen: ToolMessage[][] } {
  const m = scripted(over.steps);
  const s = memoryStore();
  const input: RunInput = {
    llm: m.llm, system: 'sys', tools: over.tools ?? [], history: [], message: 'do the work please', runId: 'run-1', store: s.store, now: () => Date.now(), dataNumbers: new Set<number>(),
    ...over,
  };
  return { input, rows: s.rows, seen: m.seen };
}

const createIdeaInput = (n: number) => ({ platform: 'YouTube', format: 'Long video', hook: `A specific idea about editing, number ${n === 0 ? 'one' : n === 1 ? 'two' : n === 2 ? 'three' : n === 3 ? 'four' : n === 4 ? 'five' : n === 5 ? 'six' : n === 6 ? 'seven' : n === 7 ? 'eight' : n === 8 ? 'nine' : 'ten'} for editors` });

test('a read tool runs, its result goes back to the model, and a grounded reply is returned', async () => {
  const read = tool('get_overview', async () => okText('{"counts":{"ideas":3}}'));
  const { input, rows, seen } = base({ steps: [use('get_overview', {}, 't1'), say('You have 3 ideas in the bank.')], tools: [read] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(r.ok && r.reply, 'You have 3 ideas in the bank.');
  assert.equal(r.ok && r.stopped, 'done');
  assert.equal(read.runs.length, 1);
  assert.equal(rows.length, 0, 'reads are not logged as actions');
  const back = seen[1][seen[1].length - 1];
  assert.equal(back.role, 'user');
  assert.match(JSON.stringify(back.content), /tool_use_id.+t1/);
});

test('a create tool runs, is logged with a pointer to the record, and appears in the actions', async () => {
  const create = tool('create_idea', async () => idea());
  const { input, rows } = base({ steps: [use('create_idea', createIdeaInput(0)), say('I added the idea to your bank.')], tools: [create] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, 'create');
  assert.equal(rows[0].status, 'done');
  assert.deepEqual({ ...rows[0].result }, { kind: 'idea', id: ID1, href: '/ideas' });
  assert.equal(r.ok && r.actions[0].record?.id, ID1);
  assert.equal(r.ok && r.actions[0].id, 'row-1');
});

test('undo facts a tool returns are stored with the log row', async () => {
  const create = tool('write_script', async () => ({ ok: true, text: 'ok', record: { kind: 'idea_script', id: ID1, href: '/ideas' }, undo: { prev_status: 'idea' } }));
  const { input, rows } = base({ steps: [use('write_script', { idea_id: ID1, script: 'A script that is long enough to be accepted by the check.' }), say('Done.')], tools: [create] });
  await runAgent(input);
  assert.deepEqual(rows[0].result.undo, { prev_status: 'idea' });
});

test('a change tool NEVER runs: it becomes a pending approval and the model is told nothing changed', async () => {
  const move = tool('move_deal', async () => okText('moved'));
  const { input, rows, seen } = base({ steps: [use('move_deal', { deal_id: ID1, stage: 'contracted' }), say('I have queued that for your approval.')], tools: [move] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(move.runs.length, 0, 'the change was executed by the loop');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tier, 'change');
  assert.equal(rows[0].status, 'pending');
  assert.equal(r.ok && r.actions[0].status, 'pending');
  assert.match(JSON.stringify(seen[1]), /NOTHING has changed/);
});

test('the same change asked twice is queued once', async () => {
  const move = tool('move_deal', async () => okText('moved'));
  const { input, rows } = base({ steps: [use('move_deal', { deal_id: ID1, stage: 'contracted' }, 'a'), use('move_deal', { deal_id: ID1, stage: 'contracted' }, 'b'), say('Queued.')], tools: [move] });
  await runAgent(input);
  assert.equal(rows.length, 1);
});

test('only registered tools run, unknown fields are refused, and the model gets the reason', async () => {
  const create = tool('create_idea', async () => idea());
  const { input, rows, seen } = base({
    steps: [use('delete_everything', {}, 'x'), use('create_idea', { ...createIdeaInput(0), extra: 'smuggled' }, 'y'), say('Could not do that.')],
    tools: [create],
  });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(create.runs.length, 0);
  assert.equal(rows.length, 0);
  assert.match(JSON.stringify(seen[1]), /no tool called/);
  assert.match(JSON.stringify(seen[2]), /Unknown field/);
});

test('invented metrics are refused; numbers the creator typed (including 12k) are accepted', async () => {
  const metrics = tool('log_metrics', async () => okText('x'));
  const a = base({ steps: [use('log_metrics', { post_id: POST, views: 5000 }), say('I need the real figure from you.')], tools: [metrics], message: 'log my post please' });
  await runAgent(a.input);
  assert.equal(a.rows.length, 0, 'a number the creator never gave must not be queued');
  assert.match(JSON.stringify(a.seen[1]), /not a number the creator gave/);

  const b = base({ steps: [use('log_metrics', { post_id: POST, views: 12000, likes: 340 }), say('Queued for your approval.')], tools: [metrics], message: 'that reel got 12k views and 340 likes' });
  await runAgent(b.input);
  assert.equal(b.rows.length, 1);
  assert.equal(b.rows[0].status, 'pending');
  assert.equal((b.rows[0].args as { views: number }).views, 12000);
});

const many = (name: string, inputs: unknown[]): Step => ({ ok: true, stopReason: 'tool_use', content: inputs.map((input, n) => ({ type: 'tool_use' as const, id: `m${n}`, name, input })) });

test('per-request caps: at most LIMITS.creates new items, LIMITS.images images, LIMITS.toolCalls calls', async () => {
  const create = tool('create_idea', async () => idea());
  const a = base({ steps: [many('create_idea', Array.from({ length: LIMITS.creates + 2 }, (_, n) => createIdeaInput(n))), say('Made the first batch.')], tools: [create] });
  const ra = await runAgent(a.input);
  assert.ok(ra.ok);
  assert.equal(create.runs.length, LIMITS.creates);
  assert.equal(a.rows.length, LIMITS.creates);
  assert.match(JSON.stringify(a.seen[1]), /limit of new items/);

  const image = tool('generate_image', async () => ({ ok: true, text: 'img', record: { kind: 'media', id: ID1, href: '/library' } }));
  const img = { prompt: 'A calm desk with a laptop and a plant, soft morning light', aspect: 'square' };
  const b = base({ steps: [many('generate_image', [img, img, img]), say('Made two images.')], tools: [image] });
  await runAgent(b.input);
  assert.equal(image.runs.length, LIMITS.images);
  assert.match(JSON.stringify(b.seen[1]), /At most 2 images/);

  const read = tool('get_overview', async () => okText('{}'));
  const c = base({ steps: [many('get_overview', Array.from({ length: LIMITS.toolCalls + 3 }, () => ({}))), say('Read it.')], tools: [read] });
  const rc = await runAgent(c.input);
  assert.ok(rc.ok);
  assert.equal(read.runs.length, LIMITS.toolCalls);
  assert.match(JSON.stringify(c.seen[1]), /used all the tool calls/);
});

test('at most LIMITS.changes approval requests are queued in one request', async () => {
  const move = tool('move_deal', async () => okText('x'));
  const stages = ['prospecting', 'negotiating', 'contracted', 'delivery', 'paid'];
  const inputs = Array.from({ length: LIMITS.changes + 1 }, (_, n) => ({ deal_id: `${n}a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a`, stage: stages[n % 5] }));
  const { input, rows } = base({ steps: [many('move_deal', inputs), say('Queued.')], tools: [move] });
  await runAgent(input);
  assert.equal(rows.length, LIMITS.changes);
  assert.equal(move.runs.length, 0);
});

test('a tool that throws is reported as a failed step and nothing is logged as done', async () => {
  const boom = tool('create_idea', async () => { throw new Error('db exploded: secret detail'); });
  const { input, rows, seen } = base({ steps: [use('create_idea', createIdeaInput(0)), say('That did not work.')], tools: [boom] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(rows.length, 0);
  assert.equal(r.ok && r.actions[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(seen[1]), /secret detail/);
});

test('a failed tool result is shown as failed with its reason and is not claimed as made', async () => {
  const dup = tool('create_idea', async () => ({ ok: false, error: 'This is nearly the same as an idea already in your bank.' }));
  const { input } = base({ steps: [use('create_idea', createIdeaInput(0)), say('x')], tools: [dup] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(r.ok && r.actions[0].status, 'failed');
});

test('a reply with a figure that is not in the data is replaced by a plain account of what was done', async () => {
  const create = tool('create_idea', async () => idea());
  const { input } = base({ steps: [use('create_idea', createIdeaInput(0)), say('Added it. This should bring about 48,000 views and $2,500 in sponsorships.')], tools: [create] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.ok(r.ok && r.notice);
  assert.match(r.ok ? r.reply : '', /Prepared 1 item/);
  assert.doesNotMatch(r.ok ? r.reply : '', /48,000/);
});

test('a reply that claims an action the agent cannot take is replaced', async () => {
  const { input } = base({ steps: [say('I have published your video to YouTube and emailed the brand.')] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.ok(r.ok && r.notice);
  assert.match(r.ok ? r.reply : '', /did not make or change anything/);
});

test('hitting the step limit stops the loop and says so', async () => {
  const read = tool('get_overview', async () => okText('{}'));
  const { input, rows } = base({ steps: [use('get_overview', {})], tools: [read] });
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(r.ok && r.stopped, 'step_limit');
  assert.ok(r.ok && r.steps <= LIMITS.steps);
  assert.match(r.ok ? r.reply : '', /limit/);
  assert.equal(rows.length, 0);
});

test('the wall-clock deadline stops the loop before another model call', async () => {
  const read = tool('get_overview', async () => okText('{}'));
  let t = 1_000_000;
  const m = scripted([use('get_overview', {})]);
  const { input } = base({ steps: [say('x')], tools: [read] });
  input.llm = async (a) => { t += 30_000; return m.llm(a); };
  input.now = () => t;
  const r = await runAgent(input);
  assert.ok(r.ok);
  assert.equal(r.ok && r.stopped, 'deadline');
});

test('AI failures: not configured is reported plainly; a failure after work was done keeps the work listed', async () => {
  const none = base({ steps: [{ ok: false, reason: 'not_configured' }] });
  const r1 = await runAgent(none.input);
  assert.equal(r1.ok, false);
  assert.equal(!r1.ok && r1.code, 'ai_unavailable');
  assert.match(!r1.ok ? r1.message : '', /ANTHROPIC_API_KEY/);

  const create = tool('create_idea', async () => idea());
  const half = base({ steps: [use('create_idea', createIdeaInput(0)), { ok: false, reason: 'timeout' }], tools: [create] });
  const r2 = await runAgent(half.input);
  assert.ok(r2.ok);
  assert.equal(r2.ok && r2.stopped, 'ai_error');
  assert.match(r2.ok ? r2.reply : '', /Prepared 1 item/);
});

test('earlier turns are passed on, and numbers only count from the creator’s own turns', async () => {
  const metrics = tool('log_metrics', async () => okText('x'));
  const { input, rows } = base({
    steps: [use('log_metrics', { post_id: POST, views: 777 }), say('Queued.')], tools: [metrics],
    history: [{ role: 'user', text: 'my last reel did 777 views' }, { role: 'assistant', text: 'Noted.' }], message: 'save it on the post please',
  });
  await runAgent(input);
  assert.equal(rows.length, 1);

  const sneaky = base({ steps: [use('log_metrics', { post_id: POST, views: 888 }), say('x')], tools: [metrics], history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'It got 888 views.' }], message: 'save it' });
  await runAgent(sneaky.input);
  assert.equal(sneaky.rows.length, 0, 'a number only the assistant said is not the creator’s number');
});

test('replyProblems: counts and dates are fine, results and money must be sourced', () => {
  const data = new Set([42, 1200]);
  assert.deepEqual(replyProblems('I made 3 drafts and 2 ideas for 2026-11-03.', data), []);
  assert.deepEqual(replyProblems('Your post has 42 views.', data), []);
  assert.ok(replyProblems('Your post has 43 views.', data).length > 0);
  assert.deepEqual(replyProblems('The invoice is $1,200.', data), []);
  assert.ok(replyProblems('The invoice is $1,300.', data).length > 0);
  assert.ok(replyProblems('This will guarantee growth.', data).length > 0);
  assert.ok(replyProblems('   ', data).length > 0);
  assert.ok(replyProblems('x'.repeat(LIMITS.replyChars + 1), data).length > 0);
  assert.ok(replyProblems('I sent the email to the brand.', data).length > 0);
  assert.ok(replyProblems('I have approved the post.', data).length > 0);
});

test('fallbackReply lists exactly what happened, and what is only waiting', () => {
  const text = fallbackReply([
    { id: '1', tool: 'create_idea', tier: 'create', status: 'done', summary: 'New YouTube idea: “x”', href: '/ideas' },
    { id: '2', tool: 'move_deal', tier: 'change', status: 'pending', summary: 'Move a deal to contracted', href: '/deals' },
    { id: null, tool: 'generate_image', tier: 'create', status: 'failed', summary: 'Image', href: '/library', error: 'Limit reached' },
  ], 'done');
  assert.match(text, /Prepared 1 item/);
  assert.match(text, /Waiting for your approval \(nothing has changed yet\)/);
  assert.match(text, /Could not do:[\s\S]*Limit reached/);
});

test('fitArgs keeps stored arguments inside the database limit by shortening long text', () => {
  const big = { title: 'T', body: 'x'.repeat(20_000), other: 'y'.repeat(100) };
  const fitted = fitArgs(big, 7000);
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).length <= 7000);
  assert.equal(fitted.title, 'T');
  assert.deepEqual(fitArgs({ a: 1 }), { a: 1 });
});

test('there is no tool that publishes, approves, sends, pays, submits or deletes', () => {
  const names = TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    'add_hook_variants', 'create_idea', 'create_publish_draft', 'draft_ad', 'generate_image', 'get_overview', 'get_record', 'list_records', 'log_metrics', 'log_post',
    'move_deal', 'schedule_idea', 'set_idea_status', 'set_invoice_status', 'write_draft', 'write_script',
  ]);
  // Anything that rewrites existing data is a 'change' (needs approval); reads and creates never overwrite.
  for (const t of TOOLS) if (/^(move|set|schedule|log_metrics)/.test(t.name)) assert.equal(t.tier, 'change', t.name);
  assert.deepEqual(TOOLS.filter((t) => t.tier === 'read').map((t) => t.name).sort(), ['get_overview', 'get_record', 'list_records']);
});
