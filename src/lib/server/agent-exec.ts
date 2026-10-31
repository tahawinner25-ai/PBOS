import 'server-only';
import { revalidatePath } from 'next/cache';
import { deleteAdDraft } from '@/actions/ads';
import { moveDeal } from '@/actions/deals';
import { deleteIdea, setIdeaStatus } from '@/actions/ideas';
import { deletePost } from '@/actions/posts';
import { deleteJob, deleteMedia } from '@/actions/publish';
import { setInvoiceStatus } from '@/actions/revenue';
import type { ActionRow } from '@/lib/agent/activity';
import { METRIC_KEYS, type IdeaStatusArgs, type InvoiceStatusArgs, type LogMetricsArgs, type MoveDealArgs, type ScheduleIdeaArgs } from '@/lib/agent/tools/specs';
import type { CreatorContext } from '@/lib/auth';
import { hasAnyMetric } from '@/lib/metrics';

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

    default:
      return bad('This kind of action cannot be undone.');
  }
}
