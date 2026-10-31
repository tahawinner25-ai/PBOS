import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { DEMO_MS, decideDemoAccess, demoSecretOk, isGatedDemoPath, newDemoSession, signDemoSession, verifyDemoSession, type DemoSession } from '../src/lib/demo-session';
import { b64url, packSigned } from '../src/lib/signing';

const SECRET = 'demo-secret-demo-secret-demo-secret-1234';
const T0 = Date.parse('2026-10-23T12:00:00Z');
const sid = 'abcdEFGH12345678';

test('weak or missing secrets are refused everywhere', async () => {
  assert.equal(demoSecretOk(undefined), false);
  assert.equal(demoSecretOk('short'), false);
  assert.equal(demoSecretOk(SECRET), true);
  await assert.rejects(() => signDemoSession(newDemoSession(T0, sid), 'short'));
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  assert.equal((await verifyDemoSession(cookie, 'short', T0)).state, 'invalid');
  assert.equal((await verifyDemoSession(cookie, undefined, T0)).state, 'invalid');
});

test('the window is exactly 10 minutes: valid at the start, valid one millisecond before the end, expired at the end', async () => {
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  const a = await verifyDemoSession(cookie, SECRET, T0);
  assert.equal(a.state, 'valid');
  assert.equal(a.state === 'valid' && a.remainingMs, DEMO_MS);
  const b = await verifyDemoSession(cookie, SECRET, T0 + DEMO_MS - 1);
  assert.equal(b.state === 'valid' && b.remainingMs, 1);
  assert.equal((await verifyDemoSession(cookie, SECRET, T0 + DEMO_MS)).state, 'expired');
  assert.equal((await verifyDemoSession(cookie, SECRET, T0 + 24 * 3_600_000)).state, 'expired');
  assert.equal(DEMO_MS, 600_000);
});

test('a forged, edited or extended cookie is rejected', async () => {
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  const [body, sig] = cookie.split('.');
  // Extend the window by editing the body but keeping the old signature.
  const longer = b64url(JSON.stringify({ sid, startedAt: T0, expiresAt: T0 + 3_600_000 }));
  assert.equal((await verifyDemoSession(`${longer}.${sig}`, SECRET, T0 + DEMO_MS + 5)).state, 'invalid');
  // Re-date the start.
  const later = b64url(JSON.stringify({ sid, startedAt: T0 + DEMO_MS, expiresAt: T0 + 2 * DEMO_MS }));
  assert.equal((await verifyDemoSession(`${later}.${sig}`, SECRET, T0 + DEMO_MS + 5)).state, 'invalid');
  // Signed with a different secret.
  const other = await signDemoSession(newDemoSession(T0, sid), 'another-secret-another-secret-another-123');
  assert.equal((await verifyDemoSession(other, SECRET, T0)).state, 'invalid');
  // Garbage in many shapes.
  for (const junk of ['', '.', 'a.b', `${body}.`, `.${sig}`, `${body}.${sig}x`, 'x'.repeat(700), `${body}.${'A'.repeat(43)}`, '{"sid":1}', `${body} .${sig}`]) {
    assert.equal((await verifyDemoSession(junk, SECRET, T0)).state, 'invalid', junk.slice(0, 20));
  }
});

test('a correctly signed cookie with a different window length or a future start is still invalid', async () => {
  const mk = async (s: DemoSession) => signDemoSession(s, SECRET);
  assert.equal((await verifyDemoSession(await mk({ sid, startedAt: T0, expiresAt: T0 + 30 * 60_000 }), SECRET, T0)).state, 'invalid');
  assert.equal((await verifyDemoSession(await mk({ sid, startedAt: T0 + 10 * 60_000, expiresAt: T0 + 20 * 60_000 }), SECRET, T0)).state, 'invalid');
  // Small clock skew between instances is tolerated.
  assert.equal((await verifyDemoSession(await mk({ sid, startedAt: T0 + 30_000, expiresAt: T0 + 30_000 + DEMO_MS }), SECRET, T0)).state, 'valid');
  assert.equal((await verifyDemoSession(await mk({ sid: 'bad sid!', startedAt: T0, expiresAt: T0 + DEMO_MS }), SECRET, T0)).state, 'invalid');
});

test('the Web Crypto signer and the node:crypto signer agree (edge and node verify the same cookie)', async () => {
  const session = newDemoSession(T0, sid);
  const viaWeb = await signDemoSession(session, SECRET);
  const body = b64url(JSON.stringify(session));
  const viaNode = `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
  assert.equal(viaWeb, viaNode);
  assert.equal(viaWeb, packSigned(session, SECRET));
  assert.equal((await verifyDemoSession(viaNode, SECRET, T0 + 1)).state, 'valid');
});

test('which paths are gated', () => {
  for (const p of ['/demo/workspace', '/demo/workspace/', '/demo/workspace/anything', '/api/demo/state', '/api/demo/end']) assert.equal(isGatedDemoPath(p), true, p);
  for (const p of ['/demo', '/demo/', '/demo/ended', '/api/demo/start', '/api/demo/start/', '/dashboard', '/demo/workspacex', '/api/demox']) assert.equal(isGatedDemoPath(p), false, p);
});

test('access decisions: pages redirect, APIs answer with a status, public paths pass', async () => {
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  const d = (pathname: string, c: string | undefined, now: number, secret: string | undefined = SECRET) => decideDemoAccess({ pathname, cookie: c, now, secret });
  assert.deepEqual(await d('/demo', undefined, T0), { action: 'public' });
  assert.deepEqual(await d('/demo/workspace', cookie, T0 + 1000), { action: 'allow', remainingMs: DEMO_MS - 1000 });
  assert.deepEqual(await d('/demo/workspace', undefined, T0), { action: 'redirect', to: '/demo' });
  assert.deepEqual(await d('/demo/workspace', 'junk', T0), { action: 'redirect', to: '/demo' });
  assert.deepEqual(await d('/demo/workspace', cookie, T0 + DEMO_MS), { action: 'redirect', to: '/demo/ended' });
  assert.deepEqual(await d('/api/demo/state', cookie, T0 + DEMO_MS), { action: 'api', status: 410, error: 'The 10-minute demo has ended.' });
  assert.deepEqual(await d('/api/demo/state', undefined, T0), { action: 'api', status: 401, error: 'Start the demo first.' });
  assert.deepEqual(await d('/api/demo/state', cookie, T0, ''), { action: 'api', status: 503, error: 'The demo is not available on this deployment.' });
  assert.deepEqual(await d('/demo/workspace', cookie, T0, 'short'), { action: 'redirect', to: '/demo' });
});

// ── starting the demo ──────────────────────────────────────────────────────
import { planDemoStart, type StartInput } from '../src/lib/demo-start';
import { DEMO_COOKIE, DEMO_USED_COOKIE } from '../src/lib/demo-session';

const base = (over: Partial<StartInput> = {}): StartInput => ({
  cookieHeader: '', now: T0, secret: SECRET, allowStart: () => true, turnstile: { mode: 'off', verify: async () => true }, newSid: () => 'abcdEFGH12345678', ...over,
});

test('start: a first visit gets a fresh 10-minute session and both cookies', async () => {
  const out = await planDemoStart(base());
  assert.equal(out.to, '/demo/workspace');
  assert.deepEqual(out.cookies.map((c) => c.name).sort(), [DEMO_COOKIE, DEMO_USED_COOKIE].sort());
  const demo = out.cookies.find((c) => c.name === DEMO_COOKIE)!;
  const check = await verifyDemoSession(demo.value, SECRET, T0 + 1);
  assert.equal(check.state, 'valid');
  assert.equal(check.state === 'valid' && check.session.expiresAt - check.session.startedAt, 600_000);
  assert.equal(demo.maxAgeSeconds, 86_400);
});

test('start: a running demo is resumed, not restarted, and does not consume a rate-limit slot', async () => {
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  let asked = 0;
  const out = await planDemoStart(base({ now: T0 + 60_000, cookieHeader: `${DEMO_COOKIE}=${cookie}; ${DEMO_USED_COOKIE}=1`, allowStart: () => { asked += 1; return true; } }));
  assert.equal(out.to, '/demo/workspace');
  assert.equal(out.cookies.length, 0);
  assert.equal(asked, 0);
});

test('start: after the 10 minutes, or with the used-marker, a second demo is refused', async () => {
  const cookie = await signDemoSession(newDemoSession(T0, sid), SECRET);
  assert.equal((await planDemoStart(base({ now: T0 + DEMO_MS, cookieHeader: `${DEMO_COOKIE}=${cookie}` }))).to, '/demo/ended');
  assert.equal((await planDemoStart(base({ cookieHeader: `${DEMO_USED_COOKIE}=1` }))).to, '/demo/ended');
  // A forged cookie is not a running demo and not an expired one; with no used-marker it is simply a new visit.
  const forged = await planDemoStart(base({ cookieHeader: `${DEMO_COOKIE}=forged.value` }));
  assert.equal(forged.to, '/demo/workspace');
});

test('start: missing secret, rate limit and Turnstile outcomes', async () => {
  assert.equal((await planDemoStart(base({ secret: undefined }))).to, '/demo?e=unavailable');
  assert.equal((await planDemoStart(base({ secret: 'short' }))).to, '/demo?e=unavailable');
  assert.equal((await planDemoStart(base({ allowStart: () => false }))).to, '/demo?e=busy');
  assert.equal((await planDemoStart(base({ turnstile: { mode: 'misconfigured', verify: async () => true } }))).to, '/demo?e=unavailable');
  const failed = await planDemoStart(base({ turnstile: { mode: 'on', verify: async () => false } }));
  assert.equal(failed.to, '/demo?e=captcha');
  assert.equal(failed.cookies.length, 0, 'a failed challenge hands out no cookie');
  assert.equal((await planDemoStart(base({ turnstile: { mode: 'on', verify: async () => true } }))).to, '/demo/workspace');
});
