import 'server-only';
import { verifyRecord } from '@/lib/agent/verify';
import { createAd, createDraftJob, createIdeaFor, createImageFor, createPostFor, saveIdeaScript, saveIdeaVariants } from './agent-create';
import { buildOverview } from '@/lib/agent/overview';
import { staticProfileContext } from '@/lib/agent/prompt';
import { SELECT_COLUMNS, TABLE, listResult, recordResult, type ViewCtx } from '@/lib/agent/read-views';
import type { ChangeCheck, RuntimeTool, ToolRunResult } from '@/lib/agent/runner';
import { TOOLS, type SendEmailArgs, type ToolName, type WebSearchArgs, type PublishPostArgs } from '@/lib/agent/tools/specs';
import type { AgentData } from '@/lib/agent/types';
import { collectNumbers } from '@/lib/agent/validate';
import { searchToolText, type WebSearch } from '@/lib/agent/web-search';
import type { CreatorContext } from '@/lib/auth';
import { isEmailAddress } from '@/lib/email-address';
import { PLATFORM_LABEL, type MediaAssetRow, type PublishJob } from '@/lib/integrations/types';
import { validateJob } from '@/lib/integrations/validate';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * The agent's tools, bound to one signed-in creator. Reads query only that creator's rows (explicit creator_id
 * filter, RLS underneath) and return allow-listed fields. Creates call the same server actions the pages use,
 * so every rule the creator meets by hand (near-duplicate refusal, media checks, daily image limit, ad copy
 * checks) applies to the agent too. 'change' tools are listed so the model can ask for them, but the runner never
 * calls their run(): they only become approval cards (see src/lib/agent/runner.ts and src/actions/agent-actions.ts).
 */

export type ToolEnv = { ctx: CreatorContext; data: AgentData; now: () => Date; /** Bound to the AI key by the route; absent in tests and when AI is not configured. */ search?: WebSearch };

/** Daily allowance of web searches per creator (each one is a paid call). */
function searchDailyLimit(): number {
  const n = Number.parseInt(process.env.AGENT_SEARCH_DAILY_LIMIT ?? '', 10);
  return Number.isFinite(n) && n > 0 && n <= 500 ? n : 30;
}

const CONNECTION_LABEL = { youtube: 'YouTube', instagram: 'Instagram', gmail: 'Gmail' } as const;
const NOT_CONNECTED = (name: string) => `${name} is not connected. Tell the creator to connect it on the Connections page.`;

const bad = (error: string): ToolRunResult => ({ ok: false, error });
const DB_ERROR = 'The workspace could not be read right now. Nothing was changed.';

export function buildRuntimeTools(env: ToolEnv): RuntimeTool[] {
  const { supabase, profile } = env.ctx;
  const viewCtx = (): ViewCtx => ({ now: env.now(), dealBrands: new Map(env.data.deals.map((d) => [d.id, d.brand ?? ''])) });

  /**
   * VERIFY: a create tool's own "done" is not enough. The server reads the made record back (creator-filtered) and
   * only then lets the agent report it as saved. A miss turns the call into a failure the agent must report.
   */
  const verified = (run: (args: any) => Promise<ToolRunResult>) => async (args: any): Promise<ToolRunResult> => {
    const r = await run(args);
    if (!r.ok || !r.record) return r;
    const check = await verifyRecord(supabase as never, profile.id, r.record);
    if (!check.ok) {
      console.error('[agent] verify failed', r.record.kind, check.reason);
      return bad(`The step reported success, but the record could not be confirmed in the workspace (${check.reason}). Do not tell the creator it was saved. Tell them to check ${r.record.href}.`);
    }
    let text = r.text;
    try { text = JSON.stringify({ verified: true, ...JSON.parse(r.text) }); } catch { /* keep the tool's own text */ }
    return { ...r, text, verified: true };
  };

  const impl: Record<ToolName, (args: any) => Promise<ToolRunResult>> = {
    /* ── read ── */
    get_overview: async () => {
      const { context } = buildOverview(env.data, env.now());
      return { ok: true, text: JSON.stringify(context) };
    },

    list_records: async (a: { kind: keyof typeof TABLE; limit: number }) => {
      const { data, error } = await supabase.from(TABLE[a.kind]).select(SELECT_COLUMNS[a.kind]).eq('creator_id', profile.id).order('created_at', { ascending: false }).limit(a.limit);
      if (error) { console.error('[agent] list_records', a.kind, error.code); return bad(DB_ERROR); }
      return { ok: true, text: listResult(a.kind, (data ?? []) as unknown as Array<Record<string, unknown>>, viewCtx()) };
    },

    get_record: async (a: { kind: keyof typeof TABLE; id: string }) => {
      const { data, error } = await supabase.from(TABLE[a.kind]).select(SELECT_COLUMNS[a.kind]).eq('id', a.id).eq('creator_id', profile.id).maybeSingle();
      if (error) { console.error('[agent] get_record', a.kind, error.code); return bad(DB_ERROR); }
      if (!data) return bad(`No ${a.kind.replace('_', ' ')} record with that id. Use an id from list_records.`);
      return { ok: true, text: recordResult(a.kind, data as unknown as Record<string, unknown>, viewCtx()) };
    },

    get_connections: async () => {
      const { data, error } = await supabase.from('social_connections').select('platform, display_name, username, status, last_synced_at').eq('creator_id', profile.id);
      if (error) { console.error('[agent] get_connections', error.code); return bad(DB_ERROR); }
      const rows = (data ?? []) as unknown as Array<{ platform: keyof typeof CONNECTION_LABEL; display_name: string | null; username: string | null; status: string; last_synced_at: string | null }>;
      const by = (p: keyof typeof CONNECTION_LABEL) => rows.find((r) => r.platform === p);
      const view = (p: keyof typeof CONNECTION_LABEL) => {
        const r = by(p);
        return r ? { connected: true, status: r.status, account: r.username ?? r.display_name ?? null, last_synced_at: r.last_synced_at?.slice(0, 10) ?? null } : { connected: false };
      };
      const active = (p: keyof typeof CONNECTION_LABEL) => by(p)?.status === 'active';
      return {
        ok: true,
        text: JSON.stringify({
          youtube: view('youtube'), instagram: view('instagram'), gmail: view('gmail'),
          can_queue_email: active('gmail'), can_queue_instagram_post: active('instagram'), can_queue_youtube_post: active('youtube'),
          note: 'A status other than "active" means the creator must reconnect on the Connections page.',
        }),
      };
    },

    web_search: async (a: WebSearchArgs) => {
      if (!env.search) return bad('Web search is not available on this server (the AI key is missing).');
      // A daily allowance through the shared counter. Without the service key only the per-request cap applies.
      const admin = createAdminClient();
      if (admin) {
        const bumped = await admin.rpc('bump_api_usage', { p_creator: profile.id, p_provider: 'agent', p_bucket: 'search', p_day: env.now().toISOString().slice(0, 10), p_units: 1 });
        if (bumped.error) console.error('[agent] search counter failed:', bumped.error.code);
        else if (Number(bumped.data ?? 0) > searchDailyLimit()) return bad(`The daily web search allowance (${searchDailyLimit()}) is used up. It resets at midnight UTC. Work from the creator's own data.`);
      }
      const r = await env.search(a.query);
      return r.ok ? { ok: true, text: searchToolText(a.query, r) } : bad(r.error);
    },

    /* ── create ── */
    create_idea: verified((a) => createIdeaFor(a)),
    write_script: verified((a) => saveIdeaScript(env.ctx, a)),
    add_hook_variants: verified((a) => saveIdeaVariants(env.ctx, a)),
    create_publish_draft: verified((a) => createDraftJob(env.ctx, a)),
    generate_image: verified((a) => createImageFor(a)),
    draft_ad: verified((a) => createAd(a)),
    log_post: verified((a) => createPostFor(a)),
    write_draft: async (a: { kind: string; title: string; body: string }) => ({
      ok: true,
      text: JSON.stringify({ created: 'text draft', note: 'Shown to the creator on screen with a Copy button. PBOS never sends it.' }),
      draft: { kind: a.kind, title: a.title, body: a.body },
    }),

    /* ── change: never run by the loop; present only so the registry is complete ── */
    move_deal: refuse,
    set_invoice_status: refuse,
    set_idea_status: refuse,
    schedule_idea: refuse,
    log_metrics: refuse,
    send_email: refuse,
    publish_post: refuse,
  };

  /**
   * Pre-queue checks for the tools that send something out. Read-only. They refuse what could never be approved and
   * fill in what only the server may decide (the address an email goes to), so the card the creator sees is exact.
   */
  const checks: Partial<Record<ToolName, (args: any) => Promise<ChangeCheck>>> = {
    send_email: async (a: SendEmailArgs) => {
      const gmail = await supabase.from('social_connections').select('status').eq('creator_id', profile.id).eq('platform', 'gmail').maybeSingle();
      if (gmail.error) return { ok: false, error: DB_ERROR };
      if (!gmail.data) return { ok: false, error: `${NOT_CONNECTED('Gmail')} Meanwhile you can use write_draft so they have text to copy.` };
      if ((gmail.data as { status: string }).status !== 'active') return { ok: false, error: 'Gmail needs to be reconnected on the Connections page before an email can be queued.' };

      let to: string | null = a.email;
      let name: string | null = null;
      if (a.deal_id) {
        const r = await supabase.from('deals').select('contact_email, contact_name, brand').eq('id', a.deal_id).eq('creator_id', profile.id).maybeSingle();
        if (r.error) return { ok: false, error: DB_ERROR };
        if (!r.data) return { ok: false, error: 'No deal with that id. Use an id from list_records.' };
        const d = r.data as unknown as { contact_email: string | null; contact_name: string | null; brand: string | null };
        to = d.contact_email?.trim().toLowerCase() || null;
        name = d.contact_name || d.brand || null;
        if (!to) return { ok: false, error: 'That deal has no contact email saved. Ask the creator for the address (they can type it in their message), or use write_draft.' };
      } else if (a.inquiry_id) {
        const r = await supabase.from('inquiries').select('email, name, company').eq('id', a.inquiry_id).eq('creator_id', profile.id).maybeSingle();
        if (r.error) return { ok: false, error: DB_ERROR };
        if (!r.data) return { ok: false, error: 'No inquiry with that id. Use an id from list_records kind inquiries.' };
        const i = r.data as unknown as { email: string; name: string; company: string | null };
        to = i.email?.trim().toLowerCase() || null;
        name = i.name || i.company || null;
      }
      if (!to || !isEmailAddress(to)) return { ok: false, error: 'The saved address does not look like a valid email address. Ask the creator for the right one.' };
      const label = name ? `${name} <${to}>` : to;
      return { ok: true, args: { ...a, to, to_name: name }, summary: `Email to ${label}: “${a.subject.length > 70 ? `${a.subject.slice(0, 69)}…` : a.subject}” (not sent)` };
    },

    publish_post: async (a: PublishPostArgs) => {
      const found = await supabase.from('publish_jobs').select('*').eq('id', a.job_id).eq('creator_id', profile.id).maybeSingle();
      if (found.error) return { ok: false, error: DB_ERROR };
      const job = found.data as PublishJob | null;
      if (!job) return { ok: false, error: 'No post draft with that id. Use an id from list_records kind publish_jobs, or make one with create_publish_draft.' };
      if (job.status !== 'draft') return { ok: false, error: `That post is already "${job.status}". Only a draft can be approved.` };

      const media = job.media_asset_ids.length ? await supabase.from('media_assets').select('*').eq('creator_id', profile.id).in('id', job.media_asset_ids) : { data: [], error: null };
      if (media.error) return { ok: false, error: DB_ERROR };
      const checked = validateJob({
        platform: job.platform, format: job.format, title: job.title, caption: job.caption, tags: job.tags, privacy: job.privacy, madeForKids: job.made_for_kids,
        scheduledFor: job.scheduled_for, mediaAssetIds: job.media_asset_ids, ideaId: job.idea_id,
      }, (media.data ?? []) as MediaAssetRow[], env.now(), 'approve');
      if (!checked.ok) return { ok: false, error: `This draft is not ready to approve: ${Object.values(checked.errors)[0]} Fix the draft first, or tell the creator what is missing.` };

      const name = CONNECTION_LABEL[job.platform];
      const conn = await supabase.from('social_connections').select('status').eq('creator_id', profile.id).eq('platform', job.platform).maybeSingle();
      if (conn.error) return { ok: false, error: DB_ERROR };
      if (!conn.data) return { ok: false, error: NOT_CONNECTED(name) };
      if ((conn.data as { status: string }).status !== 'active') return { ok: false, error: `${name} needs to be reconnected on the Connections page before this can be posted.` };

      const what = (job.title || job.caption || 'post').trim();
      const snippet = what.length > 60 ? `${what.slice(0, 59)}…` : what;
      const when = checked.value.scheduledFor
        ? ` for ${new Date(checked.value.scheduledFor).toUTCString().slice(0, 22)} UTC`
        : job.platform === 'instagram' ? ' right away' : ' (you then choose the video file)';
      return { ok: true, summary: `Publish to ${PLATFORM_LABEL[job.platform]}${when}: “${snippet}”` };
    },
  };

  return TOOLS.map((spec) => ({ spec, run: impl[spec.name as ToolName], ...(checks[spec.name as ToolName] ? { check: checks[spec.name as ToolName] } : {}) }));
}

async function refuse(): Promise<ToolRunResult> {
  return bad('This change needs the creator’s approval and cannot run on its own.');
}

/** Numbers the reply may use because they are in the creator's own data or profile. */
export function dataNumbersFor(data: AgentData, now: Date): Set<number> {
  const out = collectNumbers(buildOverview(data, now).context);
  collectNumbers(staticProfileContext(data.profile), out);
  return out;
}
