import { todayISO } from '../dates';
import { runChecks } from './checks';
import { minimalRecord } from './sources';
import type { AgentData } from './types';

/**
 * A bounded, secret-free snapshot of the creator's workspace for the agent's get_overview tool: counts, the
 * rule-based findings (with the ids they are about) and the most recent records of each kind. No contact
 * emails, captions, file paths or tokens are ever included.
 */

const RECENT = 12;

const count = <T>(items: T[], key: (t: T) => string): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + 1;
  return out;
};

export function buildOverview(data: AgentData, now: Date): { context: Record<string, unknown>; ids: Set<string> } {
  const checks = runChecks(data, now);
  const ids = new Set<string>();
  const pick = <T extends { id: string }>(items: T[]) =>
    items.slice(0, RECENT).map((i) => { ids.add(i.id); return minimalRecord(i.id, data, now); }).filter((r) => r !== null);
  checks.flags.forEach((f) => f.source_record_ids.forEach((id) => ids.add(id)));

  const posts = data.posts;
  const context = {
    today: todayISO(now),
    counts: {
      ideas_by_status: count(data.ideas, (i) => i.status),
      posts_total: posts.length,
      posts_with_views: posts.filter((p) => p.views !== null && p.views !== undefined).length,
      deals_by_stage: count(data.deals, (d) => d.stage),
      invoices_total: data.revenue.length,
      connections: (data.ops?.connections ?? []).map((c) => ({ platform: c.platform, status: c.status })),
      publish_jobs_by_status: count(data.ops?.jobs ?? [], (j) => j.status),
    },
    findings: checks.flags.map((f) => ({ pillar: f.pillar, message: f.message, source_record_ids: f.source_record_ids })),
    recent: {
      ideas: pick(data.ideas),
      posts: pick(posts),
      deals: pick(data.deals),
      invoices: pick(data.revenue),
      publish_jobs: pick(data.ops?.jobs ?? []),
      connections: pick(data.ops?.connections ?? []),
    },
  };
  return { context, ids };
}
