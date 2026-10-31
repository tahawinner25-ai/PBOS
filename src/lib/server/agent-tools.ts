import 'server-only';
import { verifyRecord } from '@/lib/agent/verify';
import { createAd, createDraftJob, createIdeaFor, createImageFor, createPostFor, saveIdeaScript, saveIdeaVariants } from './agent-create';
import { buildOverview } from '@/lib/agent/overview';
import { staticProfileContext } from '@/lib/agent/prompt';
import { SELECT_COLUMNS, TABLE, listResult, recordResult, type ViewCtx } from '@/lib/agent/read-views';
import type { RuntimeTool, ToolRunResult } from '@/lib/agent/runner';
import { TOOLS, type ToolName } from '@/lib/agent/tools/specs';
import type { AgentData } from '@/lib/agent/types';
import { collectNumbers } from '@/lib/agent/validate';
import type { CreatorContext } from '@/lib/auth';

/**
 * The agent's tools, bound to one signed-in creator. Reads query only that creator's rows (explicit creator_id
 * filter, RLS underneath) and return allow-listed fields. Creates call the same server actions the pages use,
 * so every rule the creator meets by hand (near-duplicate refusal, media checks, daily image limit, ad copy
 * checks) applies to the agent too. 'change' tools are listed so the model can ask for them, but the runner never
 * calls their run(): they only become approval cards (see src/lib/agent/runner.ts and src/actions/agent-actions.ts).
 */

export type ToolEnv = { ctx: CreatorContext; data: AgentData; now: () => Date };

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
  };

  return TOOLS.map((spec) => ({ spec, run: impl[spec.name as ToolName] }));
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
