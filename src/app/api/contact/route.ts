import { json, clientIp, readJsonObject, sameOrigin } from '@/lib/server/http';
import { resolvePublicCreator } from '@/lib/server/public';
import { rateLimit } from '@/lib/server/rate-limit';
import { turnstileConfig, verifyTurnstile } from '@/lib/server/turnstile';
import { createAdminClient } from '@/lib/supabase/admin';
import { parse, rules } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Public contact form for /work-with-me. Anyone may post, so this route validates every field,
 * rejects bot submissions via a honeypot, checks a Cloudflare Turnstile token when TURNSTILE_SECRET_KEY is
 * set, rate-limits per IP, and stores the message with the service-role client (the inquiries table has no
 * public insert policy). It never sends email.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);

  const body = await readJsonObject(request, 12_000);
  if (body === null) return json({ ok: false, error: 'The request could not be read. Reload the page and try again.' }, 400);

  // Honeypot: real visitors never fill the hidden "website" field. Pretend success so bots learn nothing.
  if (typeof body.website === 'string' && body.website.trim() !== '') return json({ ok: true });

  const ip = clientIp(request);
  const burst = rateLimit(`contact:${ip}`, 5, 3_600_000);
  if (!burst.allowed) {
    return json({ ok: false, error: 'Too many messages from this connection. Please try again later.' }, 429, { 'Retry-After': String(burst.retryAfterSec) });
  }
  const global = rateLimit('contact:all', 100, 3_600_000);
  if (!global.allowed) {
    return json({ ok: false, error: 'The form is receiving too many messages right now. Please try again later.' }, 429, { 'Retry-After': String(global.retryAfterSec) });
  }

  // Cloudflare Turnstile: required whenever it is configured. Checked after the cheap limits above so a
  // flood of bad tokens cannot be used to hammer the Cloudflare API from this route.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  const mode = turnstileConfig(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY, turnstileSecret);
  if (mode === 'misconfigured') {
    // Fail closed and say why in the logs: set NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY together.
    console.error('[api/contact] Turnstile is half configured: set both NEXT_PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither');
    return json({ ok: false, error: 'The contact form is not available right now. Please try again later.' }, 503);
  }
  if (mode === 'on') {
    const check = await verifyTurnstile({ token: body['cf-turnstile-response'], secret: turnstileSecret as string, ip });
    if (!check.ok) {
      if (check.reason === 'unavailable') {
        console.error('[api/contact] Turnstile verification could not be completed');
        return json({ ok: false, error: 'We could not verify that you are human right now. Please try again in a moment.' }, 503);
      }
      return json({ ok: false, error: 'The human check did not complete. Wait a moment for it to finish, then send again.' }, 400);
    }
  }

  const parsed = parse(
    body,
    {
      name: rules.text({ max: 120 }),
      email: rules.email(),
      company: rules.optionalText({ max: 160 }),
      message: rules.text({ min: 10, max: 4000 }),
    },
    { name: 'Name', email: 'Email', company: 'Company', message: 'Message' },
  );
  if (!parsed.ok) return json({ ok: false, error: parsed.first, fieldErrors: parsed.errors }, 400);

  try {
    const admin = createAdminClient();
    if (!admin) {
      console.error('[api/contact] SUPABASE_SERVICE_ROLE_KEY is not configured');
      return json({ ok: false, error: 'The contact form is not available right now. Please try again later.' }, 503);
    }
    const creator = await resolvePublicCreator();
    if (creator === 'unpublished') return json({ ok: false, error: 'This page is not accepting messages.' }, 404);
    if (creator === 'unavailable') return json({ ok: false, error: 'The contact form is not available right now. Please try again later.' }, 503);

    const { error } = await admin.from('inquiries').insert({
      creator_id: creator.id,
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company,
      message: parsed.data.message,
    });
    if (error) {
      console.error('[api/contact] insert', error.code, error.message);
      return json({ ok: false, error: 'Your message could not be sent. Please try again in a moment.' }, 500);
    }
    return json({ ok: true });
  } catch (err) {
    console.error('[api/contact]', err);
    return json({ ok: false, error: 'Your message could not be sent. Please try again in a moment.' }, 500);
  }
}

export async function GET() {
  return json({ ok: false, error: 'Use POST.' }, 405, { Allow: 'POST' });
}
