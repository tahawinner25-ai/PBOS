import 'server-only';
import { revalidatePath } from 'next/cache';
import { deleteAdDraft } from '@/actions/ads';
import { deleteDeal, moveDeal } from '@/actions/deals';
import { deleteIdea, setIdeaStatus, updateIdea } from '@/actions/ideas';
import { deletePost } from '@/actions/posts';
import { approveJob, deleteJob, deleteMedia } from '@/actions/publish';
import { deleteInvoice, setInvoiceStatus } from '@/actions/revenue';
import type { ActionRow } from '@/lib/agent/activity';
import { METRIC_KEYS, type IdeaStatusArgs, type InvoiceStatusArgs, type UpdateDealArgs, type UpdateIdeaArgs, type LogMetricsArgs, type MoveDealArgs, type PublishPostArgs, type ScheduleIdeaArgs, type SendEmailArgs } from '@/lib/agent/tools/specs';
import type { CreatorContext } from '@/lib/auth';
import { loadIntegrations } from '@/lib/integrations/config';
import { sendEmailAs } from '@/lib/integrations/gmail';
import { form } from './agent-create';
import { hasAnyMetric } from '@/lib/metrics';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * What happens AFTER the creator's click: applying an approved change, and undoing a created record.
 * Nothing here is reachable from the model. The agent loop only ever writes pending rows; these functions run
 * from the Approve and Undo server actions, with arguments read back from the stored row.
 */

export type Outcome = { ok: true; message: string } | { ok: false; error: string };
const good = (message: string): Outcome => ({ ok: true, message });
const bad = (error: string): Outcome => ({ ok: false, error });
const from = (r: { ok: true; message?: string } | { ok: false; error: string }, fallback: string): Outcome => (r.ok ? good(r.message ?? fallback) : bad(r.error));
const DB = 'Could not save to the database. Nothing was changed. Try again in a moment.';
const touch = (...paths: string[]) => paths.forEach((p) => revalidatePath(p));

/** Emails per creator per day, through the shared counter. A runaway or injected agent cannot mail the whole contact list. */
export function emailDailyLimit(): number {
  const n = Number.parseInt(process.env.EMAIL_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 200 ? n : 25;
}

/* ── approved changes ──────────────────────────────────────────────────── */

export async function applyChange(ctx: CreatorContext, tool: string, args: any): Promise<Outcome> {
  const { supabase, profile } = ctx;
  switch (tool) {
    case 'move_deal': {
      const a = args as MoveDealArgs;
      return from(await moveDeal(a.deal_id, a.stage), `Moved to ${a.stage}.`);
    }
    case 'set_invoice_status': {
      const a = args as InvoiceStatusArgs;
      return from(await setInvoiceStatus(a.invoice_id, a.status), `Marked as ${a.status}.`);
    }
    case 'set_idea_status': {
      const a = args as IdeaStatusArgs;
      return from(await setIdeaStatus(a.idea_id, a.status), `Moved to ${a.status}.`);
    }
    case 'schedule_idea': {
      const a = args as ScheduleIdeaArgs;
      const { data, error } = await supabase.from('ideas').select('id, status').eq('id', a.idea_id).eq('creator_id', profile.id).maybeSingle();
      if (error) return bad(DB);
      if (!data) return bad('That idea no longer exists.');
      const status = (data as { status: string }).status;
      const next = status === 'idea' || status === 'scripted' ? 'scheduled' : status;
      const up = await supabase.from('ideas').update({ scheduled_for: a.date, status: next }).eq('id', a.idea_id).eq('creator_id', profile.id);
      if (up.error) return bad(DB);
      touch('/ideas', '/dashboard');
      return good(`Scheduled for ${a.date}.`);
    }
    case 'log_metrics': {
      const a = args as LogMetricsArgs;
      const { data, error } = await supabase.from('posts').select('id, idea_id').eq('id', a.post_id).eq('creator_id', profile.id).maybeSingle();
      if (error) return bad(DB);
      if (!data) return bad('That post no longer exists.');
      // Only the figures the creator gave are written. Everything else on the post is left exactly as it was.
      const patch: Record<string, number> = {};
      for (const k of METRIC_KEYS) if (typeof a[k] === 'number') patch[k] = a[k] as number;
      if (Object.keys(patch).length === 0) return bad('There were no figures to save.');
      const up = await supabase.from('posts').update(patch).eq('id', a.post_id).eq('creator_id', profile.id);
      if (up.error) return bad(DB);
      const ideaId = (data as { idea_id: string | null }).idea_id;
      if (ideaId) {
        const idea = await supabase.from('ideas').select('status').eq('id', ideaId).eq('creator_id', profile.id).maybeSingle();
        if ((idea.data as { status?: string } | null)?.status === 'posted') await supabase.from('ideas').update({ status: 'measured' }).eq('id', ideaId).eq('creator_id', profile.id);
      }
      touch('/analytics', '/ideas', '/dashboard');
      return good('Figures saved.');
    }
    case 'update_idea': {
      // Merge the approved fields over the idea as it is NOW, so anything the creator did not touch stays exactly as it was.
      const a = args as UpdateIdeaArgs;
      const { data, error } = await supabase.from('ideas').select('id, platform, format, hook, content_mix, scheduled_for, script').eq('id', a.idea_id).eq('creator_id', profile.id).maybeSingle();
      if (error) return bad(DB);
      if (!data) return bad('That idea no longer exists.');
      const cur = data as { id: string; platform: string; format: string; hook: string; content_mix: string | null; scheduled_for: string | null; script: string | null };
      return from(await updateIdea(form({
        id: cur.id, platform: a.platform ?? cur.platform, format: a.format ?? cur.format, hook: a.hook ?? cur.hook,
        content_mix: a.content_mix ?? cur.content_mix, scheduled_for: cur.scheduled_for, script: a.script ?? cur.script,
      })), 'Idea updated.');
    }
    case 'update_deal': {
      const a = args as UpdateDealArgs;
      const patch: Record<string, string | number> = {};
      for (const k of ['contact_name', 'contact_email', 'value', 'expected_close_date', 'notes'] as const) if (a[k] !== undefined) patch[k] = a[k] as string | number;
      if (Object.keys(patch).length === 0) return bad('There were no fields to save.');
      const up = await supabase.from('deals').update(patch).eq('id', a.deal_id).eq('creator_id', profile.id).select('id');
      if (up.error) return bad(DB);
      if (!up.data?.length) return bad('That deal no longer exists.');
      touch('/deals', '/revenue', '/dashboard');
      return good('Deal updated.');
    }
    case 'send_email': {
      // Runs only from the Approve button, with the recipient and text stored on the card the creator was shown.
      const a = args as SendEmailArgs;
      if (!a.to) return bad('The recipient was not recorded on this request, so nothing was sent.');
      const admin = createAdminClient();
      if (admin) {
        const bumped = await admin.rpc('bump_api_usage', { p_creator: profile.id, p_provider: 'gmail', p_bucket: 'send', p_day: new Date().toISOString().slice(0, 10), p_units: 1 });
        if (bumped.error) console.error('[agent-exec] email counter failed:', bumped.error.code);
        else if (Number(bumped.data ?? 0) > emailDailyLimit()) return bad(`You have reached today’s limit of ${emailDailyLimit()} emails sent through PBOS. It resets at midnight UTC. Nothing was sent.`);
      }
      const setup = loadIntegrations();
      if (!setup.ok) return bad('Email is not set up on this deployment yet, so nothing was sent.');
      const sent = await sendEmailAs(setup.env, profile.id, { to: a.to, subject: a.subject, body: a.body });
      if (!sent.ok) return bad(sent.message);
      touch('/agent', '/connections');
      return good(`Sent to ${a.to} from your Gmail. Gmail accepted it (message …${sent.id.slice(-6)}).`);
    }
    case 'publish_post': {
      // The same approval the Publish page's own button performs: all of its checks apply, and it also needs the account to be connected.
      const a = args as PublishPostArgs;
      return from(await approveJob(a.job_id), 'Approved.');
    }
    default:
      return bad('This kind of change is not supported.');
  }
}

/* ── undo ──────────────────────────────────────────────────────────────── */

const textOf = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * Reverses a record the agent created. Always conservative: if the creator has since worked on the record
 * (edited the script, approved the draft, logged numbers on the post), Undo refuses and says where to go instead of
 * deleting their work.
 */
export async function undoCreated(ctx: CreatorContext, row: Pick<ActionRow, 'tool' | 'args' | 'result'>): Promise<Outcome> {
  const { supabase, profile } = ctx;
  const id = textOf(row.result.id);
  const undoInfo = (row.result.undo ?? {}) as Record<string, unknown>;

  switch (row.tool) {
    case 'write_draft':
      return good('Removed from your activity list.');

    case 'create_idea': {
      if (!id) return bad('The idea’s id was not recorded.');
      const found = await supabase.from('ideas').select('script').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The idea is already gone.');
      if (((found.data as { script: string | null }).script ?? '').trim()) return bad('You have written a script for this idea since, so Undo will not delete it. Delete it on the Ideas page if you really want to.');
      return from(await deleteIdea(id), 'Idea deleted.');
    }

    case 'write_script': {
      if (!id) return bad('The idea’s id was not recorded.');
      const { data, error } = await supabase.from('ideas').select('script, status').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (error) return bad(DB);
      if (!data) return good('The idea is already gone.');
      const idea = data as { script: string | null; status: string };
      if (row.args.truncated === true || idea.script !== row.args.script) return bad('The script has been edited since the agent wrote it, so Undo will not erase your changes. Edit or clear it on the Ideas page.');
      const prev = textOf(undoInfo.prev_status);
      const status = idea.status === 'scripted' && (prev === 'idea' || prev === 'scripted') ? prev : idea.status;
      const up = await supabase.from('ideas').update({ script: null, status }).eq('id', id).eq('creator_id', profile.id);
      if (up.error) return bad(DB);
      touch('/ideas', '/dashboard');
      return good('Script removed.');
    }

    case 'add_hook_variants': {
      if (!id) return bad('The idea’s id was not recorded.');
      const { data, error } = await supabase.from('ideas').select('hook_variants').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (error) return bad(DB);
      if (!data) return good('The idea is already gone.');
      if (JSON.stringify((data as { hook_variants: unknown }).hook_variants) !== JSON.stringify(row.args.variants)) return bad('The hook variants have been edited since the agent added them, so Undo will not erase your changes.');
      const up = await supabase.from('ideas').update({ hook_variants: [] }).eq('id', id).eq('creator_id', profile.id);
      if (up.error) return bad(DB);
      touch('/ideas');
      return good('Hook variants removed.');
    }

    case 'create_publish_draft': {
      if (!id) return bad('The draft’s id was not recorded.');
      const found = await supabase.from('publish_jobs').select('status').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The draft is already gone.');
      if ((found.data as { status: string }).status !== 'draft') return bad('This post has moved past draft (you approved or cancelled it), so Undo will not remove it. Manage it on the Publish page.');
      return from(await deleteJob(id), 'Draft deleted.');
    }

    case 'generate_image':
      // The image allowance already spent is not refunded: the provider has been paid either way.
      return id ? from(await deleteMedia(id), 'Image deleted.') : bad('The image’s id was not recorded.');

    case 'draft_ad': {
      if (!id) return bad('The ad draft’s id was not recorded.');
      const found = await supabase.from('ad_creatives').select('status').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The ad draft is already gone.');
      if ((found.data as { status: string }).status !== 'draft') return bad('You have since moved this ad out of draft, so Undo will not delete it. Manage it in the Ads Studio.');
      return from(await deleteAdDraft(id), 'Ad draft deleted.');
    }

    case 'log_post': {
      if (!id) return bad('The post’s id was not recorded.');
      const found = await supabase.from('posts').select('views, likes, comments, shares, saves, clicks').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The post is already gone.');
      if (hasAnyMetric(found.data as never)) return bad('Numbers have been logged on this post since, so Undo will not delete it. Delete it on the Analytics page if you really want to.');
      return from(await deletePost(id), 'Post record deleted.');
    }

    case 'plan_video':
    case 'plan_edit':
      // Nothing was made outside the activity row, so Undo only withdraws the plan (its link stops opening it).
      return good('Plan withdrawn.');

    case 'add_deal': {
      if (!id) return bad('The deal’s id was not recorded.');
      const found = await supabase.from('deals').select('stage').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The deal is already gone.');
      const linked = await supabase.from('revenue_entries').select('id').eq('deal_id', id).eq('creator_id', profile.id).limit(1);
      if (linked.error) return bad(DB);
      if ((linked.data ?? []).length > 0) return bad('An invoice has been linked to this deal since, so Undo will not delete it. Manage it on the Deals page.');
      if ((found.data as { stage: string }).stage !== row.args.stage) return bad('You moved this deal to another stage since, so Undo will not delete it. Delete it on the Deals page if you really want to.');
      return from(await deleteDeal(id), 'Deal deleted.');
    }

    case 'add_invoice': {
      if (!id) return bad('The invoice’s id was not recorded.');
      const found = await supabase.from('revenue_entries').select('status').eq('id', id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return bad(DB);
      if (!found.data) return good('The invoice is already gone.');
      if ((found.data as { status: string }).status !== row.args.status) return bad('The status of this invoice changed since, so Undo will not delete it. Manage it on the Revenue page.');
      return from(await deleteInvoice(id), 'Invoice deleted.');
    }

    default:
      return bad('This kind of action cannot be undone.');
  }
}
