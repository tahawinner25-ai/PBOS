import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebSearch, readSearchResponse, searchToolText } from '../src/lib/agent/web-search';

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const RESULT = { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [
  { type: 'web_search_result', url: 'https://support.google.com/youtube/answer/1', title: 'Shorts help', encrypted_content: 'zzz', page_age: 'May 2026' },
  { type: 'web_search_result', url: 'javascript:alert(1)', title: 'bad' },
  { type: 'web_search_result', url: 'https://support.google.com/youtube/answer/1', title: 'dup' },
] };
const TEXT = { type: 'text', text: 'Shorts can be up to three minutes (support.google.com).', citations: [{ type: 'web_search_result_location', url: 'https://blog.youtube/shorts', title: 'Blog' }] };

test('readSearchResponse keeps the answer, de-duplicates http(s) sources and drops other schemes', () => {
  const r = readSearchResponse([{ type: 'server_tool_use', name: 'web_search', input: { query: 'x' } }, RESULT, TEXT]);
  assert.equal(r.text, TEXT.text);
  assert.deepEqual(r.sources.map((s) => s.url), ['https://support.google.com/youtube/answer/1', 'https://blog.youtube/shorts']);
  assert.equal(r.searchError, null);
});

test('readSearchResponse surfaces a search error code', () => {
  const r = readSearchResponse([{ type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'too_many_requests' } }]);
  assert.match(r.searchError ?? '', /busy/);
});

test('createWebSearch sends the server tool with a research-only prompt and no other tools, and returns summary and sources', async () => {
  let sent: any = null;
  const search = createWebSearch({ apiKey: 'k', fetchImpl: async (_u, init) => { sent = JSON.parse(String(init?.body)); return reply({ content: [RESULT, TEXT], stop_reason: 'end_turn' }); } });
  const r = await search('shorts length');
  assert.ok(r.ok);
  assert.equal(r.ok && r.sources.length, 2);
  assert.deepEqual(sent.tools.map((t: any) => t.name), ['web_search'], 'the helper has no access to PBOS tools');
  assert.match(sent.tools[0].type, /^web_search_/);
  assert.match(sent.system, /untrusted/);
  assert.match(sent.messages[0].content, /shorts length/);
  assert.ok(!JSON.stringify(sent).includes('creator'.repeat(3)));
});

test('createWebSearch continues once after pause_turn, passing the assistant content back', async () => {
  const bodies: any[] = [];
  let n = 0;
  const search = createWebSearch({ apiKey: 'k', fetchImpl: async (_u, init) => { bodies.push(JSON.parse(String(init?.body))); n += 1; return n === 1 ? reply({ content: [RESULT], stop_reason: 'pause_turn' }) : reply({ content: [TEXT], stop_reason: 'end_turn' }); } });
  const r = await search('q');
  assert.ok(r.ok);
  assert.equal(n, 2);
  assert.equal(bodies[1].messages[1].role, 'assistant');
});

test('createWebSearch failures are plain sentences: no key, not enabled, rate limited, server error, nothing found, timeout', async () => {
  assert.match((await createWebSearch({})('q') as any).error, /AI key/);
  const status = async (s: number) => (await createWebSearch({ apiKey: 'k', fetchImpl: async () => reply({ error: { type: 'x' } }, s) })('q') as any).error as string;
  assert.match(await status(400), /not available/);
  assert.match(await status(429), /rate limiting/);
  assert.match(await status(500), /error/);
  const none = await createWebSearch({ apiKey: 'k', fetchImpl: async () => reply({ content: [{ type: 'text', text: '  ' }] }) })('q');
  assert.ok(!none.ok && /nothing usable/.test(none.error));
  const slow = await createWebSearch({ apiKey: 'k', fetchImpl: async (_u, init) => new Promise((_res, rej) => { init?.signal?.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }); }) })('q', 3100);
  assert.ok(!slow.ok && /too long/.test(slow.error));
});

test('the text handed to the agent is labelled untrusted and carries the sources', () => {
  const t = JSON.parse(searchToolText('q', { ok: true, summary: 'S', sources: [{ title: 'T', url: 'https://a.com/' }] }));
  assert.match(t.note, /untrusted/);
  assert.equal(t.sources[0].url, 'https://a.com/');
});
