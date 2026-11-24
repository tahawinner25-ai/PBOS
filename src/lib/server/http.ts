import 'server-only';
import { NextResponse } from 'next/server';
import { resolveClientIp } from '@/lib/server/client-ip';

/** JSON response that is never cached by a browser or CDN (these routes return private data). */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/**
 * CSRF defence for cookie-authenticated browser routes. Require Origin so requests that omit it
 * fail closed, then compare the full origin against the public request origin, including scheme.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;

  try {
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost ?? request.headers.get('host') ?? requestUrl.host;
    const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    const protocol = forwardedProto ? forwardedProto.replace(/:$/, '') : requestUrl.protocol.replace(/:$/, '');
    const invalidHost = [...host].some((char) =>
      char.trim() === '' || '/?#@,'.includes(char) || char === String.fromCharCode(92),
    );

    if (!host || invalidHost || !['http', 'https'].includes(protocol)) return false;

    const expectedOrigin = new URL(`${protocol}://${host}`).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

/** Parse a JSON body defensively. Returns null when the body is missing, malformed or not an object. */
export async function readJsonObject(request: Request, maxBytes = 32_000): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > maxBytes) return null;
    if (text.trim() === '') return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function clientIp(request: Request): string {
  return resolveClientIp(request.headers, process.env.TRUST_CLOUDFLARE === 'true');
}
