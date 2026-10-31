import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createLlmCaller, extractJson } from '../src/lib/agent/llm';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (text: string) => json({ content: [{ type: 'text', text }] });

describe('extractJson', () => {
  it('parses plain, fenced and prose-wrapped JSON', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(extractJson('Here you go: {"a":3} hope that helps'), { a: 3 });
    assert.throws(() => extractJson('no json here'));
  });
});

describe('createLlmCaller', () => {
  it('reports not_configured without an API key and never calls fetch', async () => {
    let called = false;
    const call = createLlmCaller({ fetchImpl: (async () => { called = true; return json({}); }) as typeof fetch });
    assert.deepEqual(await call({ staticSystem: 's', user: 'u' }), { ok: false, reason: 'not_configured' });
    assert.equal(called, false);
  });

  it('sends the key as a header, caches the static system block and parses the JSON answer', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const call = createLlmCaller({
      apiKey: 'sk-test',
      model: 'test-model',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return answer('{"ok":true}');
      }) as unknown as typeof fetch,
    });
    const res = await call({ staticSystem: 'STATIC', user: 'VARIABLE' });
    assert.deepEqual(res.ok && res.json, { ok: true });
    assert.equal(seen!.url, 'https://api.anthropic.com/v1/messages');
    const headers = seen!.init.headers as Record<string, string>;
    assert.equal(headers['x-api-key'], 'sk-test');
    const body = JSON.parse(String(seen!.init.body));
    assert.equal(body.model, 'test-model');
    assert.deepEqual(body.system, [{ type: 'text', text: 'STATIC', cache_control: { type: 'ephemeral' } }]);
    assert.equal(body.messages[0].content, 'VARIABLE');
    assert.ok(!String(seen!.init.body).includes('sk-test'), 'key must not be in the body');
  });

  it('maps failures to explicit reasons', async () => {
    const mk = (f: () => Promise<Response>) => createLlmCaller({ apiKey: 'k', fetchImpl: f as unknown as typeof fetch });
    assert.deepEqual(
      await mk(async () => json({ error: { type: 'rate_limit_error', message: 'x' } }, 429))({ staticSystem: 's', user: 'u' }),
      { ok: false, reason: 'http_error', detail: '429 rate_limit_error' },
    );
    assert.deepEqual(await mk(async () => answer('not json'))({ staticSystem: 's', user: 'u' }), { ok: false, reason: 'bad_json' });
    assert.deepEqual(await mk(async () => json({ content: [] }))({ staticSystem: 's', user: 'u' }), { ok: false, reason: 'empty' });
    const net = await mk(async () => { throw new Error('boom'); })({ staticSystem: 's', user: 'u' });
    assert.equal(net.ok, false);
    assert.equal(!net.ok && net.reason, 'network');
  });

  it('times out slow calls', async () => {
    const call = createLlmCaller({
      apiKey: 'k',
      timeoutMs: 20,
      fetchImpl: ((_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })) as unknown as typeof fetch,
    });
    assert.deepEqual(await call({ staticSystem: 's', user: 'u' }), { ok: false, reason: 'timeout' });
  });
});
