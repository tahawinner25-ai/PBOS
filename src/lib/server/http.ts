import 'server-only';
import { NextResponse } from 'next/server';
import { resolveClientIp } from '@/lib/server/client-ip';

/** JSON response that is never cached by a browser or CDN (these routes return private data). */
export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/**
 * Basic CSRF defence for cookie-authenticated POST routes: when the browser sends an Origin
 * header it must match the host being served. Requests without an Origin header (server-to-server,
 * curl) are allowed through because they carry no ambient browser credentials.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
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
