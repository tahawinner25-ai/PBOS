import { randomUUID } from 'node:crypto';
import { addDaysISO, todayISO } from './dates';

/**
 * Demo records. Every row is flagged is_demo = true, brands are obviously fictional,
 * and demo metrics are never shown on the public media kit. Nothing here is real data.
 */
const ago = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

export type DemoRows = {
  ideas: Record<string, unknown>[];
  posts: Record<string, unknown>[];
  deals: Record<string, unknown>[];
  revenue_entries: Record<string, unknown>[];
};

export function buildDemoRows(creatorId: string, now: Date, makeId: () => string = randomUUID): DemoRows {
  const base = { creator_id: creatorId, is_demo: true };
  const today = todayISO(now);
  const id = makeId;

  const idea = { stale: id(), scripted: id(), slipped: id(), posted: id(), measured: id() };
  const deal = { northwind: id(), lumen: id(), fieldnote: id(), orbit: id(), paper: id() };

  const ideas = [
    { ...base, id: idea.stale, platform: 'LinkedIn', format: 'Text post', hook: 'Why freelancers should pay themselves a salary', status: 'idea', content_mix: 'Educational', created_at: ago(now, 12) },
    { ...base, id: idea.scripted, platform: 'TikTok', format: 'Short video', hook: 'The invoice mistake that delays your payment', script: 'Hook: the one line missing from most invoices. Beat: show a before and after invoice. Close: ask viewers what they add.', status: 'scripted', content_mix: 'Educational', created_at: ago(now, 5) },
    { ...base, id: idea.slipped, platform: 'LinkedIn', format: 'Text post', hook: 'What changed when I raised my rates', status: 'scheduled', content_mix: 'Personal story', scheduled_for: addDaysISO(today, -2), created_at: ago(now, 9) },
    { ...base, id: idea.posted, platform: 'Instagram', format: 'Carousel', hook: 'A simple monthly budget for irregular income', status: 'posted', content_mix: 'Educational', created_at: ago(now, 6) },
    { ...base, id: idea.measured, platform: 'Instagram', format: 'Carousel', hook: 'Tax set-aside, explained in five slides', status: 'measured', content_mix: 'Educational', created_at: ago(now, 20) },
  ];

  const posts = [
    { ...base, idea_id: idea.measured, platform: 'Instagram', format: 'Carousel', published_at: ago(now, 18), views: 4200, likes: 310, comments: 24, shares: 41, saves: 96, clicks: 58, notes: 'Demo metrics' },
    { ...base, platform: 'Instagram', format: 'Carousel', published_at: ago(now, 25), views: 3100, likes: 190, comments: 12, shares: 20, saves: 61, clicks: 30, notes: 'Demo metrics' },
    { ...base, platform: 'TikTok', format: 'Short video', published_at: ago(now, 14), views: 9800, likes: 420, comments: 31, shares: 55, saves: 40, clicks: 12, notes: 'Demo metrics' },
    { ...base, idea_id: idea.posted, platform: 'Instagram', format: 'Carousel', published_at: ago(now, 3), notes: 'Demo post, metrics not logged yet' },
    { ...base, platform: 'LinkedIn', format: 'Text post', published_at: ago(now, 4), notes: 'Demo post, metrics not logged yet' },
  ];

  const deals = [
    { ...base, id: deal.northwind, brand: 'Northwind Audio (Demo)', contact_name: 'Priya (Demo)', contact_email: 'priya@northwind-demo.example', stage: 'negotiating', value: 4500, deliverables: ['One sponsored short video', 'Two story frames'], notes: 'Demo deal', stage_updated_at: ago(now, 9), created_at: ago(now, 21) },
    { ...base, id: deal.lumen, brand: 'Lumen Notebooks (Demo)', contact_name: 'Marcus (Demo)', contact_email: 'marcus@lumen-demo.example', stage: 'prospecting', value: 1200, deliverables: ['One carousel'], notes: 'Demo deal', stage_updated_at: ago(now, 2), created_at: ago(now, 2) },
    { ...base, id: deal.fieldnote, brand: 'Fieldnote Co (Demo)', contact_name: 'Ana (Demo)', contact_email: 'ana@fieldnote-demo.example', stage: 'contracted', value: 3000, deliverables: ['Two short videos', 'One newsletter mention'], notes: 'Demo deal', stage_updated_at: ago(now, 3), created_at: ago(now, 15) },
    { ...base, id: deal.orbit, brand: 'Orbit Coffee (Demo)', contact_name: 'Jules (Demo)', contact_email: 'jules@orbit-demo.example', stage: 'delivery', value: 2000, deliverables: ['One sponsored video'], notes: 'Demo deal', stage_updated_at: ago(now, 5), created_at: ago(now, 30) },
    { ...base, id: deal.paper, brand: 'Paper Trail App (Demo)', contact_name: 'Sam (Demo)', contact_email: 'sam@papertrail-demo.example', stage: 'paid', value: 1800, deliverables: ['One sponsored post'], notes: 'Demo deal', stage_updated_at: ago(now, 20), created_at: ago(now, 45) },
  ];

  const revenue_entries = [
    { ...base, deal_id: deal.paper, amount: 1800, currency: 'USD', status: 'paid', due_date: addDaysISO(today, -20), paid_at: addDaysISO(today, -15), notes: 'Demo invoice' },
    { ...base, deal_id: deal.orbit, amount: 2000, currency: 'USD', status: 'invoiced', due_date: addDaysISO(today, -9), notes: 'Demo invoice (past due)' },
    { ...base, deal_id: deal.fieldnote, amount: 1500, currency: 'USD', status: 'invoiced', due_date: addDaysISO(today, 10), notes: 'Demo invoice (deposit)' },
  ];

  return { ideas, posts, deals, revenue_entries };
}
