import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emailsIn, isEmailAddress } from '../src/lib/email-address';
import { buildMime, EmailRefusedError, sendEmailAs, sendGmail, toRaw, GMAIL_SEND_URL } from '../src/lib/integrations/gmail';
import { getGmailToken } from '../src/lib/integrations/connections';
import { buildGoogleAuthUrl, GMAIL_SCOPES, GMAIL_SEND_SCOPE, getGoogleUser } from '../src/lib/integrations/google';
import { createOAuthState, verifyOAuthState } from '../src/lib/integrations/oauth-state';
import { bare, CREATOR, json, makeEnv, SECRET_TOKEN } from './integration-fakes';

const MAIL = { to: 'maya@brand.com', subject: 'Following up on the spring campaign', body: 'Hi Maya,\nThanks for your time last week. Could you confirm the next step?\nBest' };
const decode = (raw: string) => Buffer.from(raw, 'base64url').toString('utf8');
const bodyOf = (mime: string) => Buffer.from(mime.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');

function connectedGmail() {
  const t = makeEnv();
  t.conns.put({ platform: 'gmail', accessToken: SECRET_TOKEN, refreshToken: '1//refresh', accessTokenExpiresAt: new Date(t.deps.clock.now + 30 * 60_000), scopes: [GMAIL_SEND_SCOPE], meta: { email: 'me@creator.com' } });
  return t;
}

/* ── addresses ─────────────────────────────────────────────────────────── */

test('isEmailAddress accepts one plain mailbox and nothing that could add a recipient or a header', () => {
  for (const ok of ['a@b.co', 'maya.lee+deals@brand-name.com', 'x_y%z@sub.domain.io']) assert.ok(isEmailAddress(ok), ok);
  for (const bad of [
    '', 'plain', 'a@b', 'a@b.c', 'a b@c.com', 'a@b.com, c@d.com', 'a@b.com;c@d.com', '<a@b.com>', 'Maya <a@b.com>', 'a@b.com\r\nBcc: evil@x.com', 'a@b.com\nSubject: x',
    '"quoted"@b.com', 'a@@b.com', `${'x'.repeat(65)}@b.com`, `a@${'d'.repeat(250)}.com`, 'a@-b.com', 'a@b..com',
  ]) assert.equal(isEmailAddress(bad), false, JSON.stringify(bad));
  assert.equal(isEmailAddress(undefined), false);
  assert.equal(isEmailAddress(42), false);
});

test('emailsIn finds addresses a person typed, lower-cased, and ignores lookalikes', () => {
  assert.deepEqual(emailsIn('Please write to Maya@Brand.com and cc jo.doe@studio.co.uk, thanks').sort(), ['jo.doe@studio.co.uk', 'maya@brand.com']);
  assert.deepEqual(emailsIn('no address here, just @mentions and a@b'), []);
});

/* ── the message ───────────────────────────────────────────────────────── */

test('buildMime: plain text UTF-8 with exactly the headers we set, and the body survives a round trip', () => {
  const mime = buildMime(MAIL);
  const [head] = mime.split('\r\n\r\n');
  const lines = head.split('\r\n');
  assert.deepEqual(lines.map((l) => l.split(':')[0]), ['To', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding']);
  assert.equal(lines[0], 'To: maya@brand.com');
  assert.equal(lines[1], 'Subject: Following up on the spring campaign');
  assert.match(lines[3], /text\/plain; charset="UTF-8"/);
  assert.equal(bodyOf(mime), MAIL.body.replace(/\n/g, '\r\n'));
  assert.ok(!/^(From|Cc|Bcc|Reply-To):/im.test(head), 'no other recipient-bearing header');
});

test('buildMime refuses anything that could inject a header or a second recipient', () => {
  for (const to of ['a@b.com\r\nBcc: evil@x.com', 'a@b.com, c@d.com', 'Maya <a@b.com>', '']) assert.throws(() => buildMime({ ...MAIL, to }), EmailRefusedError, JSON.stringify(to));
  for (const subject of ['Hi\r\nBcc: evil@x.com', 'Hi\nthere', 'Hi\rthere', 'x', 'y'.repeat(151)]) assert.throws(() => buildMime({ ...MAIL, subject }), EmailRefusedError, JSON.stringify(subject));
  assert.throws(() => buildMime({ ...MAIL, body: 'short' }), EmailRefusedError);
  assert.throws(() => buildMime({ ...MAIL, body: `hello there\0 more text` }), EmailRefusedError);
});

test('a subject with accents or emoji becomes RFC 2047 words of at most 75 characters, never split mid character', () => {
  const subject = 'Réunion confirmée — prochaines étapes pour la campagne d’été 🌞 ' + 'é'.repeat(60);
  const lines = buildMime({ ...MAIL, subject }).split('\r\n\r\n')[0].split('\r\n');
  const i = lines.findIndex((l) => l.startsWith('Subject: '));
  let j = i + 1;
  while (lines[j]?.startsWith(' ')) j += 1;
  const words = [lines[i].slice('Subject: '.length), ...lines.slice(i + 1, j).map((l) => l.slice(1))];
  assert.ok(words.length > 1, 'a long non-ASCII subject is folded');
  for (const l of lines) assert.ok(l.length <= 78, `header line of ${l.length} characters`);
  const back = words.map((w) => {
    const m = w.match(/^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/);
    assert.ok(m, w);
    assert.ok(w.length <= 75, `${w.length}`);
    return Buffer.from(m![1], 'base64').toString('utf8');
  }).join('');
  assert.equal(back, subject);
});

test('a UTF-8 body round-trips and long bodies are wrapped at 76 characters', () => {
  const body = `Bonjour Maya — merci pour l’échange. ${'Une phrase assez longue pour déborder. '.repeat(40)}`;
  const mime = buildMime({ ...MAIL, body });
  assert.equal(bodyOf(mime), body.trim().replace(/\n/g, '\r\n'));
  for (const line of mime.split('\r\n\r\n')[1].split('\r\n')) assert.ok(line.length <= 76, `${line.length}`);
});

test('toRaw is base64url (no +, / or padding) and decodes to the same message', () => {
  const raw = toRaw(MAIL);
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  assert.equal(decode(raw), buildMime(MAIL));
});

/* ── sending ───────────────────────────────────────────────────────────── */

test('sendGmail posts the raw message once with a bearer token and returns Gmail’s message id', async () => {
  const t = makeEnv();
  t.net.route('POST gmail.googleapis.com', () => json({ id: '18c0ffee', threadId: 't1' }));
  const sent = await sendGmail(t.deps, SECRET_TOKEN, MAIL);
  assert.deepEqual(sent, { id: '18c0ffee', threadId: 't1' });
  assert.equal(t.net.calls.length, 1);
  const call = t.net.calls[0];
  assert.equal(call.url, GMAIL_SEND_URL);
  assert.equal(call.headers.authorization, `Bearer ${SECRET_TOKEN}`);
  assert.equal(decode(JSON.parse(call.body as string).raw), buildMime(MAIL));
});

test('sendGmail never retries: a 503 is one attempt, because the message may already have been accepted', async () => {
  const t = makeEnv();
  t.net.route('POST gmail.googleapis.com', () => bare(503));
  await assert.rejects(() => sendGmail(t.deps, SECRET_TOKEN, MAIL));
  assert.equal(t.net.count('gmail.googleapis.com'), 1);
});

test('sendEmailAs: success records an event with the message id only, never the recipient or text', async () => {
  const t = connectedGmail();
  t.net.route('POST gmail.googleapis.com', () => json({ id: 'abc123def456' }));
  const r = await sendEmailAs(t.env, CREATOR, MAIL);
  assert.deepEqual(r, { ok: true, id: 'abc123def456', from: 'me@creator.com' });
  assert.deepEqual(t.events.types(), ['email_sent']);
  const logged = JSON.stringify(t.events.list);
  assert.ok(logged.includes('abc123def456'));
  for (const secret of [MAIL.to, MAIL.subject, 'Thanks for your time', SECRET_TOKEN]) assert.ok(!logged.includes(secret), `event leaked ${secret}`);
});

test('sendEmailAs: not connected, needs reconnecting, not configured and unsafe input are each reported plainly and send nothing', async () => {
  const none = makeEnv();
  assert.deepEqual((await sendEmailAs(none.env, CREATOR, MAIL)).ok, false);
  const r1 = await sendEmailAs(none.env, CREATOR, MAIL);
  assert.ok(!r1.ok && r1.reason === 'not_connected');

  const reauth = connectedGmail();
  reauth.conns.put({ platform: 'gmail', status: 'needs_reauth', accessToken: SECRET_TOKEN });
  const r2 = await sendEmailAs(reauth.env, CREATOR, MAIL);
  assert.ok(!r2.ok && r2.reason === 'reauth');

  const off = connectedGmail();
  const r3 = await sendEmailAs({ ...off.env, gmail: null }, CREATOR, MAIL);
  assert.ok(!r3.ok && r3.reason === 'not_configured');

  const unsafe = connectedGmail();
  const r4 = await sendEmailAs(unsafe.env, CREATOR, { ...MAIL, to: 'a@b.com\r\nBcc: evil@x.com' });
  assert.ok(!r4.ok && r4.reason === 'refused');

  for (const t of [none, reauth, off, unsafe]) assert.equal(t.net.count('gmail.googleapis.com'), 0, 'nothing was sent');
});

test('sendEmailAs: a timeout or 5xx is "unclear" (check Sent), never a plain failure and never retried', async () => {
  const t = connectedGmail();
  t.net.route('POST gmail.googleapis.com', () => bare(500));
  const r = await sendEmailAs(t.env, CREATOR, MAIL);
  assert.ok(!r.ok && r.reason === 'unclear');
  assert.match(!r.ok ? r.message : '', /Sent folder/);
  assert.equal(t.net.count('gmail.googleapis.com'), 1);
});

test('sendEmailAs: a 401 marks the connection as needing reauth; a 403 is shown as Gmail refusing', async () => {
  const a = connectedGmail();
  a.net.route('POST gmail.googleapis.com', () => json({ error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } }, 401));
  const r1 = await sendEmailAs(a.env, CREATOR, MAIL);
  assert.ok(!r1.ok && r1.reason === 'reauth');
  assert.equal((await a.conns.get(CREATOR, 'gmail'))?.status, 'needs_reauth');

  const b = connectedGmail();
  b.net.route('POST gmail.googleapis.com', () => json({ error: { code: 403, message: 'Gmail API has not been used in project 1 before or it is disabled.' } }, 403));
  const r2 = await sendEmailAs(b.env, CREATOR, MAIL);
  assert.ok(!r2.ok && r2.reason === 'rejected');
});

/* ── the connection ────────────────────────────────────────────────────── */

test('getGmailToken refreshes an expiring token and stores it; a revoked grant marks needs_reauth', async () => {
  const t = connectedGmail();
  t.conns.put({ platform: 'gmail', accessToken: 'old', refreshToken: '1//refresh', accessTokenExpiresAt: new Date(t.deps.clock.now + 30_000) });
  t.net.route('POST oauth2.googleapis.com/token', () => json({ access_token: 'ya29.fresh', expires_in: 3600, scope: GMAIL_SEND_SCOPE }));
  const got = await getGmailToken({ deps: t.deps, conns: t.conns, events: t.events, creatorId: CREATOR, google: t.env.gmail! });
  assert.equal(got.token, 'ya29.fresh');
  assert.equal((await t.conns.get(CREATOR, 'gmail'))?.accessToken, 'ya29.fresh');

  const dead = connectedGmail();
  dead.conns.put({ platform: 'gmail', accessToken: 'old', refreshToken: '1//refresh', accessTokenExpiresAt: new Date(dead.deps.clock.now - 1000) });
  dead.net.route('POST oauth2.googleapis.com/token', () => json({ error: 'invalid_grant' }, 400));
  await assert.rejects(() => getGmailToken({ deps: dead.deps, conns: dead.conns, events: dead.events, creatorId: CREATOR, google: dead.env.gmail! }), /needs to be reconnected/);
  assert.equal((await dead.conns.get(CREATOR, 'gmail'))?.status, 'needs_reauth');
});

test('the Gmail consent URL asks for send-only plus identity, does not inherit YouTube access, and uses PKCE', () => {
  const t = makeEnv();
  const created = createOAuthState({ creatorId: CREATOR, platform: 'gmail', secret: 's'.repeat(40) });
  const url = new URL(buildGoogleAuthUrl({ client: t.env.gmail!, scopes: GMAIL_SCOPES, state: created.state, codeChallenge: created.codeChallenge, includeGranted: false }));
  assert.deepEqual(url.searchParams.get('scope')!.split(' ').sort(), ['email', GMAIL_SEND_SCOPE, 'openid'].sort());
  assert.equal(url.searchParams.get('include_granted_scopes'), 'false');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/api/connect/gmail/callback');
  assert.ok(!url.searchParams.get('scope')!.includes('youtube'));
  assert.ok(!url.searchParams.get('scope')!.includes('readonly'));
  // The YouTube flow is unchanged: it still asks for incremental authorization.
  const yt = new URL(buildGoogleAuthUrl({ client: t.env.google!, scopes: ['x'], state: 's', codeChallenge: 'c' }));
  assert.equal(yt.searchParams.get('include_granted_scopes'), 'true');
});

test('the OAuth state cookie is bound to the platform: a Gmail cookie cannot finish a YouTube callback', () => {
  const secret = 's'.repeat(40);
  const created = createOAuthState({ creatorId: CREATOR, platform: 'gmail', secret });
  const args = { cookieValue: created.cookieValue, stateParam: created.state, creatorId: CREATOR, secret };
  assert.ok(verifyOAuthState({ ...args, platform: 'gmail' }).ok);
  const crossed = verifyOAuthState({ ...args, platform: 'youtube' });
  assert.ok(!crossed.ok && crossed.reason === 'platform_mismatch');
});

test('getGoogleUser returns the account, and refuses a response without an email', async () => {
  const t = makeEnv();
  t.net.route('GET openidconnect.googleapis.com', () => json({ sub: '1234', email: 'me@creator.com', email_verified: true, name: 'Me', picture: 'https://x/p.png' }), { once: true });
  const u = await getGoogleUser(t.deps, 'tok');
  assert.deepEqual(u, { sub: '1234', email: 'me@creator.com', emailVerified: true, name: 'Me', picture: 'https://x/p.png' });
  t.net.route('GET openidconnect.googleapis.com', () => json({ sub: '1234' }));
  await assert.rejects(() => getGoogleUser(t.deps, 'tok'), /email/);
});

test('Gmail rows are never picked up by the YouTube and Instagram refresh and sync jobs', async () => {
  const t = connectedGmail();
  t.conns.put({ platform: 'youtube', accessToken: 'a', refreshToken: 'r' });
  assert.deepEqual((await t.conns.listActive()).map((r) => r.platform), ['youtube']);
  assert.deepEqual((await t.conns.listRefreshCandidates()).map((r) => r.platform), ['youtube']);
});
