import { getCreatorContext, type CreatorContext } from '@/lib/auth';
import { FORMATS, PLATFORMS } from '@/lib/constants';
import {
  generateCaption,
  generateFollowups,
  generateHooks,
  generateMediaKit,
  generateOutreach,
  type GenOutcome,
} from '@/lib/generate';
import { callLlm } from '@/lib/server/ai';
import { json, readJsonObject, sameOrigin } from '@/lib/server/http';
import { rateLimit } from '@/lib/server/rate-limit';
import type { Deal, Idea, RevenueEntry } from '@/lib/types';
import { rules } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const KINDS = ['hooks', 'caption', 'outreach', 'followups', 'mediakit'] as const;
type Kind = (typeof KINDS)[number];

type Handled = { status: number; body: Record<string, unknown> };

const bad = (error: string, fieldErrors?: Record<string, string>): Handled => ({ status: 400, body: { ok: false, error, fieldErrors } });
const notFound = (what: string): Handled => ({ status: 404, body: { ok: false, error: `That ${what} no longer exists.` } });

function outcome<T>(kind: Kind, res: GenOutcome<T>): Handled {
  if (res.ok) {
    return { status: 200, body: { ok: true, kind, source: res.source, notice: res.notice ?? null, result: res.value } };
  }
  const status = res.code === 'ai_unavailable' ? 503 : 422;
  return { status, body: { ok: false, kind, code: res.code, error: res.message, details: res.details ?? null, missing: res.missing ?? null } };
}

/** DB read that returns the row or null; throws on a database error so the route answers 500. */
async function one<T>(ctx: CreatorContext, table: 'ideas' | 'deals' | 'revenue_entries', id: string): Promise<T | null> {
  const { data, error } = await ctx.supabase.from(table).select('*').eq('id', id).eq('creator_id', ctx.profile.id).maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as T | null) ?? null;
}

async function handle(kind: Kind, body: Record<string, unknown>, ctx: CreatorContext): Promise<Handled> {
  const now = new Date();

  if (kind === 'hooks') {
    const ideaId = rules.optionalUuid()(body.idea_id, 'Idea');
    if (!ideaId.ok) return bad(ideaId.error);
    if (ideaId.value) {
      const idea = await one<Idea>(ctx, 'ideas', ideaId.value);
      if (!idea) return notFound('idea');
      if (!idea.hook) return bad('This idea has no hook to build variants from.');
      return outcome(kind, await generateHooks(callLlm, ctx.profile, { hook: idea.hook, platform: idea.platform, format: idea.format }));
    }
    const hook = rules.text({ min: 5, max: 280 })(body.hook, 'Hook');
    if (!hook.ok) return bad(hook.error, { hook: hook.error });
    const platform = rules.optionalOneOf(PLATFORMS)(body.platform, 'Platform');
    if (!platform.ok) return bad(platform.error, { platform: platform.error });
    const format = rules.optionalOneOf(FORMATS)(body.format, 'Format');
    if (!format.ok) return bad(format.error, { format: format.error });
    return outcome(kind, await generateHooks(callLlm, ctx.profile, { hook: hook.value, platform: platform.value, format: format.value }));
  }

  if (kind === 'caption') {
    const ideaId = rules.uuid()(body.idea_id, 'Idea');
    if (!ideaId.ok) return bad(ideaId.error);
    const platform = rules.oneOf(PLATFORMS)(body.platform, 'Platform');
    if (!platform.ok) return bad(platform.error, { platform: platform.error });
    const format = rules.optionalOneOf(FORMATS)(body.format, 'Format');
    if (!format.ok) return bad(format.error, { format: format.error });
    const angle = rules.optionalText({ max: 280 })(body.angle, 'Angle');
    if (!angle.ok) return bad(angle.error, { angle: angle.error });

    const source = await one<Idea>(ctx, 'ideas', ideaId.value);
    if (!source) return notFound('idea');
    const core = (source.script?.trim() || source.hook?.trim() || '').trim();
    if (!core) return bad('This idea has no hook or script to adapt.');

    // Captions already written for sibling adaptations must not be repeated for this platform.
    const { data, error } = await ctx.supabase
      .from('ideas')
      .select('id, script, adapted_from')
      .eq('creator_id', ctx.profile.id)
      .not('script', 'is', null)
      .limit(200);
    if (error) throw new Error(`ideas: ${error.message}`);
    const family = ((data ?? []) as Pick<Idea, 'id' | 'script' | 'adapted_from'>[]).filter(
      (i) => i.id !== source.id && (i.adapted_from === source.id || (source.adapted_from !== null && (i.id === source.adapted_from || i.adapted_from === source.adapted_from))),
    );
    return outcome(
      kind,
      await generateCaption(callLlm, ctx.profile, {
        coreMessage: core,
        platform: platform.value,
        format: format.value,
        angle: angle.value,
        avoid: family.map((i) => i.script as string),
      }),
    );
  }

  if (kind === 'outreach') {
    const dealId = rules.uuid()(body.deal_id, 'Deal');
    if (!dealId.ok) return bad(dealId.error);
    const deal = await one<Deal>(ctx, 'deals', dealId.value);
    if (!deal) return notFound('deal');
    return outcome(kind, await generateOutreach(callLlm, ctx.profile, deal, now));
  }

  if (kind === 'followups') {
    const invoiceId = rules.uuid()(body.invoice_id, 'Invoice');
    if (!invoiceId.ok) return bad(invoiceId.error);
    const invoice = await one<RevenueEntry>(ctx, 'revenue_entries', invoiceId.value);
    if (!invoice) return notFound('invoice');
    const deal = invoice.deal_id ? await one<Deal>(ctx, 'deals', invoice.deal_id) : null;
    return outcome(kind, await generateFollowups(callLlm, ctx.profile, invoice, deal, now));
  }

  return outcome(kind, await generateMediaKit(callLlm, ctx.profile));
}

/**
 * The five supported generations. Everything is generated server-side for the signed-in creator,
 * from that creator's own records, and returned for review: nothing here saves, sends or publishes.
 */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);

  const ctx = await getCreatorContext();
  if (!ctx) return json({ ok: false, error: 'Sign in to generate drafts.' }, 401);

  const body = await readJsonObject(request);
  if (body === null) return json({ ok: false, error: 'The request body must be a small JSON object.' }, 400);

  const kind = rules.oneOf(KINDS)(body.kind, 'kind');
  if (!kind.ok) return json({ ok: false, error: kind.error }, 400);

  const burst = rateLimit(`gen:${ctx.profile.id}`, 12, 60_000);
  if (!burst.allowed) {
    return json({ ok: false, error: `Too many requests. Wait ${burst.retryAfterSec}s and try again.` }, 429, { 'Retry-After': String(burst.retryAfterSec) });
  }
  const hourly = rateLimit(`gen-hour:${ctx.profile.id}`, 120, 3_600_000);
  if (!hourly.allowed) {
    return json({ ok: false, error: 'Hourly generation limit reached. Try again later.' }, 429, { 'Retry-After': String(hourly.retryAfterSec) });
  }

  try {
    const result = await handle(kind.value, body, ctx);
    return json(result.body, result.status);
  } catch (err) {
    console.error('[api/generate]', err);
    return json({ ok: false, error: 'Something went wrong while generating. Nothing was saved. Try again.' }, 500);
  }
}

export async function GET() {
  return json({ ok: false, error: 'Use POST.' }, 405, { Allow: 'POST' });
}
