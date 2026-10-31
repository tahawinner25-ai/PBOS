import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { IntegrationError, classifyGoogle, classifyMeta, parseRetryAfter, redact } from '../src/lib/integrations/errors';
import { generateKey, needsRotation, parseKeyring, decryptToken, encryptToken, tokenAad, TokenCryptoError } from '../src/lib/integrations/crypto';
import { backoffDelay, request, requestJson } from '../src/lib/integrations/http';
import { OAUTH_COOKIE, createOAuthState, pkcePair, verifyOAuthState } from '../src/lib/integrations/oauth-state';
import { assertSecret, packSigned, safeEqual, unpackSigned } from '../src/lib/signing';
import { FakeNet, bare, json, makeDeps } from './integration-fakes';

const key = () => generateKey();
const aad = tokenAad('creator-1', 'youtube', 'refresh_token_enc');

describe('token encryption (AES-256-GCM, versioned key ring)', () => {
  const ring = parseKeyring({ single: key() }) as NonNullable<ReturnType<typeof parseKeyring>>;

  it('round-trips and never contains the plaintext', () => {
    const envelope = encryptToken('1//refresh-token-value', ring, aad);
    assert.match(envelope, /^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*$/);
    assert.ok(!envelope.includes('refresh-token-value'));
    assert.equal(decryptToken(envelope, ring, aad), '1//refresh-token-value');
  });
  it('uses a fresh IV every time', () => {
    assert.notEqual(encryptToken('same', ring, aad), encryptToken('same', ring, aad));
  });
  it('rejects a ciphertext moved to another row or column (AAD binding)', () => {
    const envelope = encryptToken('secret', ring, aad);
    assert.throws(() => decryptToken(envelope, ring, tokenAad('creator-2', 'youtube', 'refresh_token_enc')), (e) => e instanceof TokenCryptoError && e.code === 'auth_failed');
    assert.throws(() => decryptToken(envelope, ring, tokenAad('creator-1', 'youtube', 'access_token_enc')), TokenCryptoError);
  });
  it('detects tampering with any part of the envelope', () => {
    const [v, iv, tag, ct] = encryptToken('secret-value', ring, aad).split(':');
    const flip = (s: string) => (s[0] === 'A' ? 'B' : 'A') + s.slice(1);
    for (const bad of [`${v}:${flip(iv)}:${tag}:${ct}`, `${v}:${iv}:${flip(tag)}:${ct}`, `${v}:${iv}:${tag}:${flip(ct)}`]) {
      assert.throws(() => decryptToken(bad, ring, aad), TokenCryptoError);
    }
  });
  it('rejects malformed envelopes and unknown key versions without echoing them', () => {
    assert.throws(() => decryptToken('plaintext-token', ring, aad), (e) => e instanceof TokenCryptoError && e.code === 'bad_envelope');
    assert.throws(() => decryptToken('v9:aaaa:bbbb:cccc', ring, aad), (e) => e instanceof TokenCryptoError && e.code === 'unknown_key_version');
    try { decryptToken('ya29.leaky-looking-token', ring, aad); } catch (e) { assert.ok(!String((e as Error).message).includes('leaky')); }
  });
  it('supports rotation: new writes use the newest key, old rows still decrypt', () => {
    const k1 = key(); const k2 = key();
    const old = parseKeyring({ keys: `1:${k1}` }) as NonNullable<ReturnType<typeof parseKeyring>>;
    const rotated = parseKeyring({ keys: `2:${k2},1:${k1}` }) as NonNullable<ReturnType<typeof parseKeyring>>;
    const oldEnvelope = encryptToken('t', old, aad);
    assert.equal(rotated.current, 2);
    assert.equal(decryptToken(oldEnvelope, rotated, aad), 't');
    assert.ok(needsRotation(oldEnvelope, rotated));
    const fresh = encryptToken('t', rotated, aad);
    assert.ok(fresh.startsWith('v2:'));
    assert.ok(!needsRotation(fresh, rotated));
  });
  it('refuses a half-working key ring', () => {
    assert.equal(parseKeyring({}), null);
    assert.throws(() => parseKeyring({ single: Buffer.from('short').toString('base64') }), (e) => e instanceof TokenCryptoError && e.code === 'bad_key');
    assert.throws(() => parseKeyring({ keys: `1:${key()},1:${key()}` }), TokenCryptoError);
    assert.throws(() => parseKeyring({ keys: 'not-a-pair' }), TokenCryptoError);
  });
  it('produces envelopes the database CHECK constraint accepts', () => {
    assert.match(encryptToken('x', ring, aad), /^v[0-9]+:/);
  });
});

describe('signing helpers', () => {
  const secret = 's'.repeat(40);
  it('round-trips and rejects forgery', () => {
    const packed = packSigned({ a: 1 }, secret);
    assert.deepEqual(unpackSigned(packed, secret), { a: 1 });
    assert.equal(unpackSigned(packed, 'x'.repeat(40)), null);
    assert.equal(unpackSigned(packed.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), secret), null);
    const [body] = packed.split('.');
    assert.equal(unpackSigned(`${Buffer.from('{"a":2}').toString('base64url')}.${packed.split('.')[1]}`, secret), null);
    assert.equal(unpackSigned(`${body}`, secret), null);
    assert.equal(unpackSigned(undefined, secret), null);
    assert.equal(unpackSigned('x'.repeat(5000), secret), null);
  });
  it('rejects weak secrets and compares in constant time without throwing on length differences', () => {
    assert.throws(() => assertSecret('short', 'OAUTH_STATE_SECRET'));
    assert.throws(() => assertSecret(undefined, 'OAUTH_STATE_SECRET'));
    assert.equal(assertSecret(secret, 'X'), secret);
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abcd'), false);
  });
});

describe('OAuth state and PKCE', () => {
  const secret = 'o'.repeat(48);
  const base = { creatorId: 'creator-1', platform: 'youtube' as const, secret };

  it('PKCE challenge is the S256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
  });
  it('accepts the genuine callback exactly once-shaped and returns the verifier', () => {
    const made = createOAuthState({ ...base, now: 1_000 });
    const ok = verifyOAuthState({ ...base, cookieValue: made.cookieValue, stateParam: made.state, now: 2_000 });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(createHash('sha256').update(ok.codeVerifier).digest('base64url'), made.codeChallenge);
    assert.equal(OAUTH_COOKIE, 'pbos_oauth');
  });
  it('rejects a missing cookie or state', () => {
    const made = createOAuthState(base);
    assert.deepEqual(verifyOAuthState({ ...base, cookieValue: undefined, stateParam: made.state }), { ok: false, reason: 'missing' });
    assert.deepEqual(verifyOAuthState({ ...base, cookieValue: made.cookieValue, stateParam: null }), { ok: false, reason: 'missing' });
  });
  it('rejects a different state, platform or creator, an expired cookie and a forged cookie', () => {
    const made = createOAuthState({ ...base, now: 0 });
    const v = (over: object) => verifyOAuthState({ ...base, cookieValue: made.cookieValue, stateParam: made.state, now: 1_000, ...over });
    assert.deepEqual(v({ stateParam: 'attacker-state' }), { ok: false, reason: 'state_mismatch' });
    assert.deepEqual(v({ platform: 'instagram' }), { ok: false, reason: 'platform_mismatch' });
    assert.deepEqual(v({ creatorId: 'creator-2' }), { ok: false, reason: 'creator_mismatch' });
    assert.deepEqual(v({ now: 11 * 60_000 }), { ok: false, reason: 'expired' });
    assert.deepEqual(v({ secret: 'z'.repeat(48) }), { ok: false, reason: 'bad_signature' });
    assert.deepEqual(v({ cookieValue: packSigned({ n: made.state, p: 'youtube', c: 'creator-1', v: 'v', exp: 9e15 }, 'a'.repeat(48)) }), { ok: false, reason: 'bad_signature' });
  });
  it('uses unpredictable values', () => {
    const a = createOAuthState({ ...base, random: (n) => randomBytes(n) });
    const b = createOAuthState({ ...base, random: (n) => randomBytes(n) });
    assert.notEqual(a.state, b.state);
    assert.notEqual(a.codeChallenge, b.codeChallenge);
  });
});

describe('error classification', () => {
  const g = (status: number, body: unknown) => classifyGoogle('youtube', status, JSON.stringify(body), null);
  const m = (status: number, body: unknown) => classifyMeta('instagram', status, JSON.stringify(body), null);

  it('Google: quota, rate limit, auth, permission, missing channel', () => {
    assert.equal(g(403, { error: { errors: [{ reason: 'quotaExceeded' }] } }).kind, 'quota');
    assert.equal(g(403, { error: { errors: [{ reason: 'uploadLimitExceeded' }] } }).kind, 'quota');
    assert.equal(g(403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }).kind, 'rate_limit');
    assert.equal(g(429, {}).kind, 'rate_limit');
    assert.equal(g(401, {}).kind, 'auth');
    assert.equal(g(403, { error: { errors: [{ reason: 'forbidden' }] } }).kind, 'permission');
    assert.match(g(403, { error: { errors: [{ reason: 'youtubeSignupRequired' }] } }).userMessage, /no YouTube channel/);
    assert.equal(g(500, {}).retryable, true);
    assert.equal(g(400, {}).retryable, false);
    assert.equal(g(404, {}).kind, 'not_found');
  });
  it('Google OAuth endpoint errors', () => {
    assert.equal(g(400, { error: 'invalid_grant' }).kind, 'auth');
    assert.equal(g(401, { error: 'invalid_client' }).kind, 'permission');
    assert.equal(g(400, { error: 'invalid_request' }).kind, 'invalid');
  });
  it('Meta: expired token, rate limits, permission, invalid parameter, media not ready, server error', () => {
    assert.equal(m(400, { error: { code: 190, error_subcode: 463 } }).kind, 'auth');
    assert.equal(m(400, { error: { code: 4 } }).kind, 'rate_limit');
    assert.equal(m(400, { error: { code: 17 } }).kind, 'rate_limit');
    assert.equal(m(400, { error: { code: 613 } }).kind, 'rate_limit');
    assert.equal(m(403, { error: { code: 10 } }).kind, 'permission');
    assert.equal(m(403, { error: { code: 200 } }).kind, 'permission');
    assert.equal(m(400, { error: { code: 100, message: 'Invalid parameter' } }).kind, 'invalid');
    assert.equal(m(400, { error: { code: 9007 } }).kind, 'transient');
    assert.equal(m(500, {}).kind, 'transient');
    assert.equal(m(400, { error: { code: 190 } }).retryable, false);
  });
  it('redacts credentials from anything that reaches a log or a user', () => {
    const dirty = 'GET /me?access_token=EAAB1234567890123456789012345678901234567890&x=1 Bearer ya29.abcDEF123456 refresh_token=1//0gAbCdEfGhIjKlMnOpQrStUv {"access_token":"abc","client_secret":"s3"}';
    const clean = redact(dirty);
    for (const leak of ['EAAB1234', 'ya29.abc', '1//0gAbC', '"abc"', 's3']) assert.ok(!clean.includes(leak), `leaked ${leak}`);
    const err = new IntegrationError({ kind: 'invalid', platform: 'instagram', detail: 'bad access_token=EAAB12345678901234567890123456789012345 given' });
    assert.ok(!err.message.includes('EAAB12345'));
    assert.ok(!err.userMessage.includes('EAAB12345'));
  });
  it('parses Retry-After in seconds and as a date, capped at an hour', () => {
    assert.equal(parseRetryAfter('7'), 7000);
    assert.equal(parseRetryAfter('99999'), 3_600_000);
    assert.equal(parseRetryAfter(new Date(10_000).toUTCString(), 4_000), 6000);
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter('soon'), null);
  });
});

describe('retrying HTTP', () => {
  const opts = { platform: 'youtube' as const };

  it('backoff grows, stays under the cap and is jittered between half and full', () => {
    assert.equal(backoffDelay(1, 500, 8000, () => 0), 250);
    assert.equal(backoffDelay(1, 500, 8000, () => 1), 500);
    assert.equal(backoffDelay(3, 500, 8000, () => 1), 2000);
    assert.equal(backoffDelay(10, 500, 8000, () => 1), 8000);
  });
  it('retries a 503 and succeeds, sleeping between tries', async () => {
    const net = new FakeNet().route('GET /x', () => bare(503), { once: true }).route('GET /x', () => json({ ok: true }));
    const deps = makeDeps(net);
    assert.deepEqual(await requestJson(deps, 'https://api.test/x', {}, opts), { ok: true });
    assert.equal(net.calls.length, 2);
    assert.equal(deps.sleeps.length, 1);
  });
  it('honours Retry-After but never sleeps past the cap', async () => {
    const net = new FakeNet().route('GET /x', () => json({}, 429, { 'retry-after': '120' }), { once: true }).route('GET /x', () => json({ ok: 1 }));
    const deps = makeDeps(net);
    await request(deps, 'https://api.test/x', {}, { ...opts, maxDelayMs: 5000 });
    assert.deepEqual(deps.sleeps, [5000]);
  });
  it('does not retry a rejection that cannot heal', async () => {
    const net = new FakeNet().route('GET /x', () => json({ error: { errors: [{ reason: 'forbidden' }] } }, 403));
    await assert.rejects(request(makeDeps(net), 'https://api.test/x', {}, opts), (e) => e instanceof IntegrationError && e.kind === 'permission');
    assert.equal(net.calls.length, 1);
  });
  it('maxAttempts 1 means exactly one call (used for media_publish)', async () => {
    const net = new FakeNet().route('POST /pub', () => bare(503));
    await assert.rejects(request(makeDeps(net), 'https://api.test/pub', { method: 'POST' }, { ...opts, maxAttempts: 1 }));
    assert.equal(net.calls.length, 1);
  });
  it('turns network failures into transient errors and gives up after the attempts', async () => {
    const net = new FakeNet().on(() => true, () => { throw new TypeError('fetch failed'); });
    await assert.rejects(request(makeDeps(net), 'https://api.test/x', {}, { ...opts, maxAttempts: 3 }), (e) => e instanceof IntegrationError && e.kind === 'transient' && e.code === 'network');
    assert.equal(net.calls.length, 3);
  });
  it('treats extra statuses as success (308 resume incomplete)', async () => {
    const net = new FakeNet().route('PUT /up', () => bare(308, { range: 'bytes=0-9' }));
    const res = await request(makeDeps(net), 'https://api.test/up', { method: 'PUT' }, { ...opts, okStatuses: [308] });
    assert.equal(res.status, 308);
  });
  it('error messages never contain request credentials', async () => {
    const net = new FakeNet().route('GET /x', () => json({ error: { message: 'Invalid OAuth access token - access_token=EAAB1234567890123456789012345678901234567890' } }, 400));
    await assert.rejects(request(makeDeps(net), 'https://api.test/x?access_token=EAAB1234567890123456789012345678901234567890', {}, { platform: 'instagram' }), (e) => !String((e as Error).message).includes('EAAB1234'));
  });
});
