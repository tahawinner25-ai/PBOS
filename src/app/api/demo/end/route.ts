import { NextResponse } from 'next/server';
import { DEMO_COOKIE } from '@/lib/demo-session';
import { json, sameOrigin } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** "End demo now". The middleware has already confirmed the demo is open. The used-marker stays, so it cannot be restarted at once. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const res = new NextResponse(null, { status: 303, headers: { Location: '/demo/ended', 'Cache-Control': 'no-store' } });
  res.cookies.set(DEMO_COOKIE, '', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  return res;
}

export async function GET() {
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
