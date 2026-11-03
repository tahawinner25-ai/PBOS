import assert from 'node:assert/strict';
import test from 'node:test';
import { clerkDomainOf, isTokenRejected, keyRole, looksLikeAnonKey } from '../src/lib/auth-errors';

const b64url = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64url({ alg: 'HS256' })}.${b64url({ iss: 'supabase', role })}.sig`;

test('a token Supabase cannot verify is recognised; ordinary failures are not', () => {
  assert.equal(isTokenRejected({ code: 'PGRST301', message: 'No suitable key or wrong key type' }), true);
  assert.equal(isTokenRejected({ code: 'PGRST302', message: 'x' }), true);
  assert.equal(isTokenRejected({ message: 'JWSError JWSInvalidSignature' }), true);
  assert.equal(isTokenRejected({ code: '42501', message: 'permission denied for table creator_profile' }), false);
  assert.equal(isTokenRejected({ code: '57014', message: 'canceling statement due to statement timeout' }), false);
  assert.equal(isTokenRejected(null), false);
});

test('the service-role key guard reads the role claim and never mistakes the real key for the anon key', () => {
  assert.equal(keyRole(jwt('anon')), 'anon');
  assert.equal(looksLikeAnonKey(jwt('anon')), true);
  assert.equal(looksLikeAnonKey(jwt('authenticated')), true);
  assert.equal(looksLikeAnonKey(jwt('service_role')), false);
  assert.equal(looksLikeAnonKey('sb_secret_abcdefghijklmnop'), false);
  assert.equal(looksLikeAnonKey('not a key'), false);
  assert.equal(keyRole('a.b.c'), null);
});

test('the Clerk domain is read from the publishable key and nothing else is trusted', () => {
  const key = `pk_test_${Buffer.from('example-app-12.clerk.accounts.dev$').toString('base64url')}`;
  assert.equal(clerkDomainOf(key), 'example-app-12.clerk.accounts.dev');
  assert.equal(clerkDomainOf(undefined), null);
  assert.equal(clerkDomainOf('sk_test_abc'), null);
  assert.equal(clerkDomainOf(`pk_test_${Buffer.from('<script>$').toString('base64url')}`), null);
});
