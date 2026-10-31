/**
 * What the 10-minute demo shows. Everything here is invented sample data run through the real rules
 * engine: the same checks the signed-in agent uses decide what is flagged and recommended. There is no
 * database, no sign-in, no AI call and no way to publish anything from the demo.
 */
import { buildDailyPlan, type DailyPlan } from './agent/daily';
import type { AgentData } from './agent/types';
import { buildDemoRows } from './demo';
import { followupTemplates, outreachTemplate } from './generate/templates';
import { summarizeAnalytics, type AnalyticsSummary } from './metrics';
import type { CreatorProfile, Deal, Idea, Post, RevenueEntry } from './types';

export const SAMPLE_CREATOR = 'sample-creator';

export const SAMPLE_PROFILE: CreatorProfile = {
  id: SAMPLE_CREATOR,
  user_id: 'sample-user',
  name: 'Alex Rivera (sample)',
  niche: 'personal finance for freelancers',
  positioning: 'Plain-language money habits for people with irregular income.',
  voice: 'Calm, practical, no hype.',
  goals: { primary: 'Land two sponsored deals this quarter', secondary: 'Grow the newsletter' },
  audience_notes: 'Freelance designers and developers in their first three years.',
  services: [{ name: 'Sponsored short video', description: 'One short video with a clear call to action.' }],
  rate_card: [{ item: 'Sponsored short video', price: null, currency: 'USD', notes: 'Sample only' }],
  faq: [],
  ai_persona: null,
  media_kit_published: false,
  avatar_path: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

export type DemoDraft = { key: string; title: string; subject: string | null; body: string; sources: string[] };

export type DemoView = {
  data: AgentData;
  plan: DailyPlan;
  analytics: AnalyticsSummary;
  draft: DemoDraft | null;
};

/** Sample records with stable, obviously fake ids. */
export function demoAgentData(now: Date): AgentData {
  let n = 0;
  const rows = buildDemoRows(SAMPLE_CREATOR, now, () => `sample-${++n}`);
  const at = now.toISOString();
  const ideas: Idea[] = rows.ideas.map((r) => ({ script: null, hook_variants: [], scheduled_for: null, adapted_from: null, updated_at: at, ...r }) as unknown as Idea);
  const posts: Post[] = rows.posts.map((r, i) => ({ id: `sample-post-${i + 1}`, idea_id: null, clicks: null, shares: null, saves: null, likes: null, comments: null, views: null, created_at: (r.published_at as string) ?? at, updated_at: at, source: 'manual', ...r }) as unknown as Post);
  const deals: Deal[] = rows.deals.map((r) => ({ expected_close_date: null, updated_at: at, ...r }) as unknown as Deal);
  const revenue: RevenueEntry[] = rows.revenue_entries.map((r, i) => ({ id: `sample-invoice-${i + 1}`, paid_at: null, created_at: at, updated_at: at, ...r }) as unknown as RevenueEntry);
  return { profile: SAMPLE_PROFILE, ideas, posts, deals, revenue, events: [] };
}

/** Template-built draft (no AI), for the one asset the agent would write first. */
export function demoDraft(data: AgentData, plan: DailyPlan, now: Date): DemoDraft | null {
  const intent = plan.draftIntent;
  if (!intent) return null;
  if (intent.key === 'invoices_overdue') {
    const invoiceId = intent.source_record_ids[0];
    const invoice = data.revenue.find((r) => r.id === invoiceId);
    const deal = data.deals.find((d) => d.id === invoice?.deal_id) ?? null;
    if (!invoice) return null;
    const draft = followupTemplates(SAMPLE_PROFILE, invoice, deal, now)[0];
    return { key: intent.key, title: 'Overdue invoice follow-up', subject: draft.subject, body: draft.body, sources: intent.source_record_ids };
  }
  if (intent.key === 'deals_stale') {
    const deal = data.deals.find((d) => d.id === intent.source_record_ids[0]);
    if (!deal) return null;
    const draft = outreachTemplate(SAMPLE_PROFILE, deal);
    return { key: intent.key, title: 'Follow-up for a stalled deal', subject: draft.subject, body: draft.body, sources: intent.source_record_ids };
  }
  return null;
}

export function buildDemoView(now: Date): DemoView {
  const data = demoAgentData(now);
  const plan = buildDailyPlan(data, now);
  return { data, plan, analytics: summarizeAnalytics(data.posts), draft: demoDraft(data, plan, now) };
}
