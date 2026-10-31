import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveClientIp } from '../src/lib/server/client-ip';
import { turnstileConfig, verifyTurnstile } from '../src/lib/server/turnstile';
import { buildCsp, clerkFrontendHost, securityHeaders } from '../src/lib/security-headers.mjs';

const headers = (entries: Record<string, string>) => ({ get: (name: string) => entries[name.toLowerCase()] ?? null });
const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('resolveClientIp', () => {
  it('ignores cf-connecting-ip unless Cloudflare is trusted', () => {
    const h = headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2, 3.3.3.3' });
    assert.equal(resolveClientIp(h, false), '2.2.2.2');
  });
  it('uses cf-connecting-ip when Cloudflare is trusted, and falls back when it is absent', () => {
    assert.equal(resolveClientIp(headers({ 'cf-connecting-ip': ' 1.1.1.1 ', 'x-forwarded-for': '2.2.2.2' }), true), '1.1.1.1');
    assert.equal(resolveClientIp(headers({ 'x-forwarded-for': '2.2.2.2' }), true), '2.2.2.2');
  });
  it('falls back to x-real-ip and then to "unknown"', () => {
    assert.equal(resolveClientIp(headers({ 'x-real-ip': '4.4.4.4' }), false), '4.4.4.4');
    assert.equal(resolveClientIp(headers({}), false), 'unknown');
    assert.equal(resolveClientIp(headers({ 'x-forwarded-for': ' ' }), false), 'unknown');
  });
});

describe('verifyTurnstile', () => {
  const reply = (body: unknown, ok = true) => async () => ({ ok, json: async () => body });

  it('accepts a token Cloudflare confirms and sends the secret, token and IP', async () => {
    let sent: URLSearchParams | undefined;
    const result = await verifyTurnstile({
      token: 'tok',
      secret: 'sec',
      ip: '9.9.9.9',
      fetchImpl: async (_url, init) => {
        sent = init.body;
        return { ok: true, json: async () => ({ success: true }) };
      },
    });
    assert.deepEqual(result, { ok: true });
    assert.equal(sent?.get('secret'), 'sec');
    assert.equal(sent?.get('response'), 'tok');
    assert.equal(sent?.get('remoteip'), '9.9.9.9');
  });

  it('does not send an unknown IP', async () => {
    let sent: URLSearchParams | undefined;
    await verifyTurnstile({ token: 't', secret: 's', ip: 'unknown', fetchImpl: async (_u, init) => ((sent = init.body), { ok: true, json: async () => ({ success: true }) }) });
    assert.equal(sent?.has('remoteip'), false);
  });

  it('rejects a missing, empty, non-string or oversized token without calling Cloudflare', async () => {
    const never = async () => {
      throw new Error('should not be called');
    };
    for (const token of [undefined, null, '', '   ', 42, 'x'.repeat(2049)]) {
      assert.deepEqual(await verifyTurnstile({ token, secret: 's', fetchImpl: never }), { ok: false, reason: 'missing' });
    }
  });

  it('rejects a token Cloudflare says is invalid, including any non-true success value', async () => {
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: reply({ success: false }) }), { ok: false, reason: 'rejected' });
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: reply({ success: 'true' }) }), { ok: false, reason: 'rejected' });
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: reply(null) }), { ok: false, reason: 'rejected' });
  });

  it('fails closed when Cloudflare cannot be reached or answers badly', async () => {
    assert.deepEqual(await verifyTurnstile({ token: 't', secret: 's', fetchImpl: reply({}, false) }), { ok: false, reason: 'unavailable' });
    assert.deepEqual(
      await verifyTurnstile({
        token: 't',
        secret: 's',
        fetchImpl: async () => {
          throw new Error('network down');
        },
      }),
      { ok: false, reason: 'unavailable' },
    );
    assert.deepEqual(
      await verifyTurnstile({ token: 't', secret: 's', fetchImpl: async () => ({ ok: true, json: async () => Promise.reject(new Error('bad json')) }) }),
      { ok: false, reason: 'unavailable' },
    );
  });
});

describe('turnstileConfig', () => {
  it('is on only when both keys are set, off when neither is, and misconfigured otherwise', () => {
    assert.equal(turnstileConfig('site', 'secret'), 'on');
    assert.equal(turnstileConfig(undefined, undefined), 'off');
    assert.equal(turnstileConfig('', '  '), 'off');
    assert.equal(turnstileConfig('site', undefined), 'misconfigured');
    assert.equal(turnstileConfig(undefined, 'secret'), 'misconfigured');
  });
});

describe('clerkFrontendHost', () => {
  it('reads the host out of a publishable key', () => {
    assert.equal(clerkFrontendHost(`pk_test_${b64('example-app-12.clerk.accounts.dev$')}`), 'example-app-12.clerk.accounts.dev');
    assert.equal(clerkFrontendHost(`pk_live_${b64('clerk.example.com$')}`), 'clerk.example.com');
  });
  it('returns null for anything that is not a key', () => {
    for (const bad of [undefined, '', 'pk_test_', 'nonsense', `pk_test_${b64('no-dollar.example.com')}`, `pk_test_${b64('bad host!$')}`, `pk_test_${b64('localhost$')}`]) {
      assert.equal(clerkFrontendHost(bad), null, String(bad));
    }
  });
});

describe('Content-Security-Policy', () => {
  const key = `pk_live_${b64('clerk.example.com$')}`;
  const prod = buildCsp({ production: true, clerkPublishableKey: key, supabaseUrl: 'https://abc.supabase.co', plausibleDomain: 'example.com' });
  const dev = buildCsp({ production: false });
  const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('allows Clerk, Turnstile, Plausible and Supabase where they are needed', () => {
    assert.match(directive(prod, 'script-src'), /https:\/\/clerk\.example\.com/);
    assert.match(directive(prod, 'script-src'), /https:\/\/challenges\.cloudflare\.com/);
    assert.match(directive(prod, 'script-src'), /https:\/\/plausible\.io/);
    assert.match(directive(prod, 'connect-src'), /https:\/\/clerk\.example\.com/);
    assert.match(directive(prod, 'frame-src'), /https:\/\/challenges\.cloudflare\.com/);
    assert.match(directive(prod, 'img-src'), /https:\/\/img\.clerk\.com/);
    assert.match(directive(prod, 'img-src'), /https:\/\/abc\.supabase\.co/);
  });

  it('is locked down in production', () => {
    assert.ok(!prod.includes('unsafe-eval'));
    assert.ok(!prod.includes('ws:'));
    assert.ok(prod.includes('upgrade-insecure-requests'));
    assert.equal(directive(prod, 'object-src'), "object-src 'none'");
    assert.equal(directive(prod, 'frame-ancestors'), "frame-ancestors 'none'");
    assert.equal(directive(prod, 'form-action'), "form-action 'self'");
    assert.equal(directive(prod, 'default-src'), "default-src 'self'");
  });

  it('only loosens for development, and leaves out hosts that are not configured', () => {
    assert.match(directive(dev, 'script-src'), /unsafe-eval/);
    assert.match(directive(dev, 'connect-src'), /ws:/);
    assert.ok(!dev.includes('plausible.io'));
    assert.ok(!dev.includes('supabase.co'));
    assert.ok(!dev.includes('upgrade-insecure-requests'));
  });

  it('ignores a malformed Supabase URL instead of throwing', () => {
    assert.doesNotThrow(() => buildCsp({ production: true, supabaseUrl: 'http://[bad' }));
  });
});

describe('securityHeaders', () => {
  it('enforces the policy by default and can switch to report-only', () => {
    const names = (opts: { reportOnly?: boolean }) => securityHeaders({ production: true, ...opts }).map((h) => h.key);
    assert.ok(names({}).includes('Content-Security-Policy'));
    assert.ok(!names({}).includes('Content-Security-Policy-Report-Only'));
    assert.ok(names({ reportOnly: true }).includes('Content-Security-Policy-Report-Only'));
    assert.ok(!names({ reportOnly: true }).includes('Content-Security-Policy'));
  });

  it('sends HSTS only in production', () => {
    assert.ok(securityHeaders({ production: true }).some((h) => h.key === 'Strict-Transport-Security'));
    assert.ok(!securityHeaders({ production: false }).some((h) => h.key === 'Strict-Transport-Security'));
  });
});
