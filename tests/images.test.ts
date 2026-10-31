import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateOpenAiImage, instagramFeedRatioOk, safeModel, sizeFor, DEFAULT_IMAGE_MODEL } from '../src/lib/images/openai';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const ok = (bytes: Buffer) => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const err = (status: number, code?: string) => new Response(JSON.stringify({ error: { code, message: 'SECRET PROMPT ECHO' } }), { status });
const SECRET_KEY = 'sk-test-SECRET-KEY-123';
const SECRET_PROMPT = 'a very private prompt about my launch';

function capture(reply: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return reply(); }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test('no key means an explicit not_configured, and no network call', async () => {
  const c = capture(() => ok(JPEG));
  const r = await generateOpenAiImage({ fetchImpl: c.fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'square' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, 'not_configured');
  assert.equal(c.calls.length, 0);
});

test('request asks for JPEG, one image, the right size, and sends the key only as a bearer header', async () => {
  const c = capture(() => ok(JPEG));
  const r = await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: c.fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'landscape' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.mime, 'image/jpeg');
  assert.equal(r.width, 1536);
  assert.equal(r.height, 1024);
  const body = JSON.parse(String(c.calls[0].init.body));
  assert.equal(body.output_format, 'jpeg');
  assert.equal(body.n, 1);
  assert.equal(body.size, '1536x1024');
  assert.equal(body.response_format, undefined, 'GPT image models reject response_format');
  assert.ok(!JSON.stringify(body).includes(SECRET_KEY));
  assert.equal((c.calls[0].init.headers as Record<string, string>).authorization, `Bearer ${SECRET_KEY}`);
});

test('a PNG (or anything not JPEG) is discarded', async () => {
  const r = await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: capture(() => ok(PNG)).fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'square' });
  assert.equal(r.ok === false && r.reason, 'bad_response');
});

test('garbage base64 and missing data are rejected, not stored', async () => {
  const garbage = capture(() => new Response(JSON.stringify({ data: [{ b64_json: '<script>alert(1)</script>' }] }), { status: 200 }));
  assert.equal((await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: garbage.fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'square' })).ok, false);
  const empty = capture(() => new Response(JSON.stringify({ data: [] }), { status: 200 }));
  assert.equal((await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: empty.fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'square' })).ok, false);
});

test('error messages never contain the prompt, the key or the provider body', async () => {
  for (const [status, code, reason] of [[400, 'moderation_blocked', 'refused'], [429, undefined, 'rate_limited'], [401, 'invalid_api_key', 'http_error'], [500, undefined, 'http_error']] as const) {
    const r = await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: capture(() => err(status, code)).fetchImpl }, { prompt: SECRET_PROMPT, aspect: 'square' });
    assert.equal(r.ok, false);
    if (r.ok) continue;
    assert.equal(r.reason, reason);
    for (const secret of [SECRET_KEY, SECRET_PROMPT, 'SECRET PROMPT ECHO']) assert.ok(!r.message.includes(secret), `${status} leaked ${secret}`);
  }
});

test('timeout and network failures map to their own reasons', async () => {
  const slow = (async (_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => { (init.signal as AbortSignal).addEventListener('abort', () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); }); })) as unknown as typeof fetch;
  const t = await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: slow, timeoutMs: 20 }, { prompt: SECRET_PROMPT, aspect: 'square' });
  assert.equal(t.ok === false && t.reason, 'timeout');
  const down = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  const n = await generateOpenAiImage({ apiKey: SECRET_KEY, fetchImpl: down }, { prompt: SECRET_PROMPT, aspect: 'square' });
  assert.equal(n.ok === false && n.reason, 'network');
});

test('model names are validated; sizes follow the model; Instagram ratio check', () => {
  assert.equal(safeModel('gpt-image-1.5'), 'gpt-image-1.5');
  assert.equal(safeModel('x"; drop table'), DEFAULT_IMAGE_MODEL);
  assert.equal(safeModel(undefined), DEFAULT_IMAGE_MODEL);
  assert.equal(sizeFor('portrait', 'gpt-image-1').size, '1024x1536');
  assert.equal(sizeFor('portrait', 'gpt-image-2').size, '1024x1280');
  assert.equal(instagramFeedRatioOk(1024, 1280), true);
  assert.equal(instagramFeedRatioOk(1024, 1536), false);
  assert.equal(instagramFeedRatioOk(1536, 1024), true);
  assert.equal(instagramFeedRatioOk(3000, 1000), false);
  assert.equal(instagramFeedRatioOk(null, 100), null);
});
