import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { companyAddress, companyName, governingLaw, unresolvedPlaceholders } from '../src/lib/company';
import { deletionStatus, parseDeletionCode } from '../src/lib/deletion-status';
import robots, { PRIVATE_PATHS, PUBLIC_PATHS } from '../src/app/robots';

const KEYS = ['NEXT_PUBLIC_COMPANY_NAME', 'NEXT_PUBLIC_COMPANY_ADDRESS', 'NEXT_PUBLIC_GOVERNING_LAW', 'NEXT_PUBLIC_CONTACT_EMAIL'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('company placeholders', () => {
  it('shows visible [bracketed] placeholders and lists what is missing', () => {
    for (const k of KEYS) delete process.env[k];
    assert.match(companyName(), /^\[.+\]$/);
    assert.match(companyAddress(), /^\[.+\]$/);
    assert.match(governingLaw(), /^\[.+\]$/);
    assert.deepEqual(unresolvedPlaceholders().sort(), [...KEYS].sort());
  });
  it('uses real values once set and reports nothing missing', () => {
    process.env.NEXT_PUBLIC_COMPANY_NAME = 'Acme Ltd';
    process.env.NEXT_PUBLIC_COMPANY_ADDRESS = '1 Main St';
    process.env.NEXT_PUBLIC_GOVERNING_LAW = 'England and Wales';
    process.env.NEXT_PUBLIC_CONTACT_EMAIL = 'hi@example.com';
    assert.equal(companyName(), 'Acme Ltd');
    assert.deepEqual(unresolvedPlaceholders(), []);
  });
  it('treats whitespace-only values as missing', () => {
    process.env.NEXT_PUBLIC_COMPANY_NAME = '   ';
    assert.ok(unresolvedPlaceholders().includes('NEXT_PUBLIC_COMPANY_NAME'));
  });
});

describe('data deletion status', () => {
  it('only accepts 16 lowercase hex characters', () => {
    assert.equal(parseDeletionCode('0123456789abcdef'), '0123456789abcdef');
    assert.equal(parseDeletionCode(['0123456789abcdef']), '0123456789abcdef');
    for (const bad of ['', 'ABCDEF0123456789', '0123456789abcde', '0123456789abcdef0', "0123456789abcde'", '0123456789abcdeg', undefined, null, 5]) assert.equal(parseDeletionCode(bad), null, String(bad));
  });
  it('reports the latest completion time and never anything else', () => {
    assert.deepEqual(deletionStatus(null, null), { state: 'none' });
    assert.deepEqual(deletionStatus('0123456789abcdef', []), { state: 'unknown' });
    assert.deepEqual(deletionStatus('0123456789abcdef', null), { state: 'unknown' });
    assert.deepEqual(deletionStatus('0123456789abcdef', [{ created_at: '2026-10-01T00:00:00Z' }, { created_at: '2026-10-02T00:00:00Z' }]), { state: 'done', at: '2026-10-02T00:00:00Z' });
  });
});

describe('robots', () => {
  it('keeps every signed-in and demo-workspace page out of search results', () => {
    const rule = (robots().rules as Array<{ disallow: string[]; allow: string[] }>)[0];
    for (const p of ['/dashboard', '/publish', '/agent', '/library', '/ads', '/studio', '/connections', '/settings', '/api/', '/demo/workspace']) assert.ok(rule.disallow.includes(p), p);
    for (const p of ['/', '/demo', '/blog', '/privacy', '/terms', '/cookies', '/security', '/data-deletion', '/accessibility']) assert.ok(rule.allow.includes(p), p);
  });
  it('never lists a path as both allowed and disallowed', () => {
    for (const p of PUBLIC_PATHS) assert.ok(!(PRIVATE_PATHS as readonly string[]).includes(p), p);
  });
});
