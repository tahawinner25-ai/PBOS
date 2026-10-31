import { contactEmail, siteUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** RFC 9116 security contact. Returns 404 until a contact email is configured, so we never publish a placeholder. */
export function GET() {
  const email = contactEmail();
  if (!email) return new Response('Not configured', { status: 404 });
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = [`Contact: mailto:${email}`, `Expires: ${expires}`, `Preferred-Languages: en`, `Canonical: ${siteUrl()}/.well-known/security.txt`, `Policy: ${siteUrl()}/security`, ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
}
