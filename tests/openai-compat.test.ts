import assert from 'node:assert/strict';
import test from 'node:test';
import { createCompatLlmCaller, createCompatToolLlm, toOpenAiMessages } from '../src/lib/agent/openai-compat';
import type { ToolMessage } from '../src/lib/agent/tool-llm';

type Call = { url: string; init: RequestInit };
const scripted = (status: number, body: unknown, calls: Call[] = []): typeof fetch =>
  (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); }) as unknown as typeof fetch;

const TOOLS = [{ name: 'get_overview', description: 'x', input_schema: { type: 'object' as const, properties: {} } }];

test('Anthropic-style history becomes OpenAI messages: tool calls on the assistant, results as tool messages', () => {
  const history: ToolMessage[] = [
    { role: 'user', content: 'what is up' },
    { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 'c1', name: 'get_overview', input: { a: 1 } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true}' }] },
  ];
  const out = toOpenAiMessages('SYS', history);
  assert.deepEqual(out[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(out[1], { role: 'user', content: 'what is up' });
  assert.deepEqual(out[2], { role: 'assistant', content: 'Looking.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_overview', arguments: '{"a":1}' } }] });
  assert.deepEqual(out[3], { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' });
});

test('a tool call from the model comes back as a tool_use block, with a made-up id when the provider sends none', async () => {
  const calls: Call[] = [];
  const llm = createCompatToolLlm({ apiKey: 'k', baseUrl: 'https://example.test/v1/', fetchImpl: scripted(200, { choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ function: { name: 'get_overview', arguments: '{}' } }] } }] }, calls) });
  const r = await llm({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
  assert.ok(r.ok);
  assert.equal(r.ok && r.stopReason, 'tool_use');
  const block = r.ok ? r.content[0] : null;
  assert.equal(block?.type, 'tool_use');
  assert.ok(block && block.type === 'tool_use' && block.id.length > 3 && block.name === 'get_overview');
  assert.equal(calls[0].url, 'https://example.test/v1/chat/completions');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer k');
});

test('a plain answer ends the turn; malformed tool arguments are flagged, not crashed on', async () => {
  const a = await createCompatToolLlm({ apiKey: 'k', fetchImpl: scripted(200, { choices: [{ finish_reason: 'stop', message: { content: 'Done.' } }] }) })({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
  assert.ok(a.ok && a.stopReason === 'end_turn');
  const b = await createCompatToolLlm({ apiKey: 'k', fetchImpl: scripted(200, { choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'z', function: { name: 'get_overview', arguments: '{oops' } }] } }] }) })({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: TOOLS });
  assert.ok(b.ok);
  assert.deepEqual(b.ok && b.content[0].type === 'tool_use' ? b.content[0].input : null, { _unparsed: true });
});

test('failures are reported with a usable detail, and no key means not configured', async () => {
  const none = await createCompatToolLlm({})({ system: 's', messages: [], tools: [] });
  assert.equal(!none.ok && none.reason, 'not_configured');
  const bad = await createCompatToolLlm({ apiKey: 'k', fetchImpl: scripted(429, [{ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota' } }]) })({ system: 's', messages: [{ role: 'user', content: 'x' }], tools: [] });
  assert.ok(!bad.ok && bad.reason === 'http_error' && /^429/.test(bad.detail ?? ''));
});

test('the JSON caller parses the answer, tolerating code fences', async () => {
  const call = createCompatLlmCaller({ apiKey: 'k', fetchImpl: scripted(200, { choices: [{ message: { content: '```json\n{"a":1}\n```' } }] }) });
  const r = await call({ staticSystem: 's', user: 'u' });
  assert.ok(r.ok && (r.json as { a: number }).a === 1);
  const bad = await createCompatLlmCaller({ apiKey: 'k', fetchImpl: scripted(200, { choices: [{ message: { content: 'not json' } }] }) })({ staticSystem: 's', user: 'u' });
  assert.equal(!bad.ok && bad.reason, 'bad_json');
});
