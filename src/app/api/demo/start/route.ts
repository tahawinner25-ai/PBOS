import { NextResponse } from 'next/server';
import { planDemoStart } from '@/lib/demo-start';
import { clientIp, json, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import { turnstileConfig, verifyTurnstile } from '@/lib/server/turnstile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Starts the 10-minute demo. A plain form POST (works without JavaScript) answered with a redirect.
 * The rules and their order live in src/lib/demo-start.ts, where they are tested.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  const ip = clientIp(request);
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  const outcome = await planDemoStart({
    cookieHeader: request.headers.get('cookie') ?? '',
    now: Date.now(),
    secret: process.env.DEMO_SESSION_SECRET,
    allowStart: () => rateLimit(`demo-start:${ip}`, 5, 3_600_000).allowed,
    turnstile: {
      mode: turnstileConfig(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, secretKey),
      verify: async () => {
        let token: unknown = null;
        try {
          token = (await request.formData()).get('cf-turnstile-response');
        } catch {
          /* no body: treated as a missing token */
        }
        return (await verifyTurnstile({ token, secret: secretKey as string, ip })).ok;
      },
    },
    newSid: () => crypto.randomUUID().replace(/-/g, ''),
  });
  const res = new NextResponse(null, { status: 303, headers: { Location: outcome.to, 'Cache-Control': 'no-store' } });
  for (const c of outcome.cookies) res.cookies.set(c.name, c.value, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: c.maxAgeSeconds });
  return res;
}

export async function GET() {
  return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
}
