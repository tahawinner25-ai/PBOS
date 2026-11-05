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
  assert.deepEqual(out[3], { role: 'tool', tool_call_id: 'c1', name: 'get_overview', content: '{"ok":true}' });
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

import { checkCompatConnection, sanitizeSchema, toOpenAiTools } from '../src/lib/agent/openai-compat';

test('sanitizeSchema strips additionalProperties at every depth and keeps the rest', () => {
  const out = sanitizeSchema({ type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { b: { type: 'string' } }, additionalProperties: false } } }, additionalProperties: false }) as Record<string, unknown>;
  assert.equal(JSON.stringify(out).includes('additionalProperties'), false);
  assert.equal(JSON.stringify(out).includes('"b"'), true);
});

test('a tool with no properties is sent without parameters', () => {
  const [t] = toOpenAiTools([{ name: 'x', description: 'd', input_schema: { type: 'object', properties: {}, additionalProperties: false } }]) as Array<{ function: Record<string, unknown> }>;
  assert.equal('parameters' in t.function, false);
});

test('checkCompatConnection reports the provider text and the failing step, never the key', async () => {
  const f = (async () => new Response('{"error":{"message":"bad key sk-secret"}}', { status: 400 })) as unknown as typeof fetch;
  const r = await checkCompatConnection({ apiKey: 'sk-secret', fetchImpl: f }, []);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.step, 'plain');
    assert.equal(r.status, 400);
    assert.equal(r.detail.includes('sk-secret'), false);
  }
});

test('checkCompatConnection succeeds when both requests pass', async () => {
  const f = (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
  const r = await checkCompatConnection({ apiKey: 'k', fetchImpl: f }, []);
  assert.equal(r.ok, true);
});

import { pickModel } from '../src/lib/agent/openai-compat';

test('pickModel prefers the newest plain flash model and skips image/tts variants', () => {
  assert.equal(pickModel(['models/gemini-2.5-flash-image', 'models/gemini-2.0-flash', 'models/gemini-3-flash', 'models/gemini-3-pro']), 'gemini-3-flash');
  assert.equal(pickModel(['models/embedding-001']), null);
});

test('a 404 for the model name retries once with a model the provider lists', async () => {
  const urls: string[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url.endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'models/gemini-3-flash' }] }), { status: 200 });
    const model = JSON.parse(String(init?.body)).model;
    return model === 'gemini-3-flash'
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), { status: 200 })
      : new Response('{"error":{"message":"not found"}}', { status: 404 });
  }) as unknown as typeof fetch;
  const r = await createCompatLlmCaller({ apiKey: 'k', baseUrl: 'https://x.test/v1', model: 'old-model', fetchImpl: f })({ staticSystem: 's', user: 'u' });
  assert.equal(r.ok, true);
  assert.equal(urls.length, 3);
});

test('a 503 on the default model falls back to another model instead of failing', async () => {
  const seen: string[] = [];
  const f = (async (_url: string, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model as string;
    seen.push(model);
    return model === 'gemini-flash-lite-latest'
      ? new Response(JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] }), { status: 200 })
      : new Response('{"error":{"message":"high demand"}}', { status: 503 });
  }) as unknown as typeof fetch;
  const r = await createCompatLlmCaller({ apiKey: 'k', fetchImpl: f })({ staticSystem: 's', user: 'u' });
  assert.equal(r.ok, true);
  assert.deepEqual(seen, ['gemini-flash-latest', 'gemini-flash-lite-latest']);
});

test('the connection test also tries the fallback models on a 503', async () => {
  const f = (async (_u: string, init?: RequestInit) => new Response('{}', { status: JSON.parse(String(init?.body)).model === 'gemini-2.5-flash-lite' ? 200 : 503 })) as unknown as typeof fetch;
  const r = await checkCompatConnection({ apiKey: 'k', fetchImpl: f }, []);
  assert.equal(r.ok, true);
});

test('Gemini round trip: the thought signature is kept and replayed, and tool results carry the function name', async () => {
  const sig = { google: { thought_signature: 'abc123' } };
  const llm = createCompatToolLlm({ apiKey: 'k', fetchImpl: scripted(200, { choices: [{ message: { content: null, tool_calls: [{ id: 't1', extra_content: sig, function: { name: 'get_overview', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }) });
  const r = await llm({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: TOOLS });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const msgs = toOpenAiMessages('s', [
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: r.content },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
  ]) as Array<Record<string, unknown>>;
  const assistant = msgs.find((m) => m.role === 'assistant') as { tool_calls: Array<{ extra_content?: unknown }> };
  assert.deepEqual(assistant.tool_calls[0].extra_content, sig);
  assert.equal((msgs.find((m) => m.role === 'tool') as { name?: string }).name, 'get_overview');
});
