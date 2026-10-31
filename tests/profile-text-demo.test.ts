import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDemoRows } from '../src/lib/demo';
import { runChecks } from '../src/lib/agent/checks';
import {
  deliverablesFromText,
  faqFromText,
  faqToText,
  rateCardFromText,
  rateCardToText,
  servicesFromText,
  servicesToText,
} from '../src/lib/profile-text';
import type { Deal, Idea, Post, RevenueEntry } from '../src/lib/types';
import { CREATOR_ID, NOW, makeData } from './fixtures';

describe('settings text formats', () => {
  it('round-trips services, rate card and FAQ', () => {
    const s = servicesFromText('Sponsored video | One dedicated short video\nNewsletter mention');
    assert.ok(s.ok);
    assert.deepEqual(s.ok && s.value, [
      { name: 'Sponsored video', description: 'One dedicated short video' },
      { name: 'Newsletter mention', description: '' },
    ]);
    assert.equal(servicesToText(s.ok ? s.value : []), 'Sponsored video | One dedicated short video\nNewsletter mention');

    const r = rateCardFromText('Sponsored video | $1,500 | usage 30 days\nBundle |', 'USD');
    assert.ok(r.ok);
    assert.deepEqual(r.ok && r.value, [
      { item: 'Sponsored video', price: 1500, currency: 'USD', notes: 'usage 30 days' },
      { item: 'Bundle', price: null, currency: 'USD' },
    ]);
    assert.equal(rateCardToText(r.ok ? r.value : []), 'Sponsored video | 1500 | usage 30 days\nBundle');

    const f = faqFromText('Do you disclose sponsorships? | Always.');
    assert.deepEqual(f.ok && f.value, [{ q: 'Do you disclose sponsorships?', a: 'Always.' }]);
    assert.equal(faqToText(f.ok ? f.value : []), 'Do you disclose sponsorships? | Always.');
  });

  it('reports the offending line for bad input', () => {
    const r = rateCardFromText('Video | lots', 'USD');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /line 1: the price must be a number/);
    assert.match(!faqFromText('Only a question').ok ? 'bad' : '', /bad/);
    assert.equal(deliverablesFromText('a\n\nb').ok, true);
    assert.equal(deliverablesFromText(Array.from({ length: 11 }, (_, i) => `d${i}`).join('\n')).ok, false);
  });
});

describe('demo data', () => {
  const rows = buildDemoRows(CREATOR_ID, NOW);

  it('flags every row as demo and belongs to the creator', () => {
    for (const table of Object.values(rows)) {
      for (const row of table) {
        assert.equal(row.is_demo, true);
        assert.equal(row.creator_id, CREATOR_ID);
      }
    }
  });

  it('uses obviously fictional brands and reserved example domains', () => {
    for (const d of rows.deals) {
      assert.match(String(d.brand), /\(Demo\)$/);
      assert.match(String(d.contact_email), /\.example$/);
    }
  });

  it('has consistent links between ideas, posts, deals and invoices', () => {
    const ideaIds = new Set(rows.ideas.map((i) => i.id));
    const dealIds = new Set(rows.deals.map((d) => d.id));
    for (const p of rows.posts) if (p.idea_id) assert.ok(ideaIds.has(p.idea_id), 'post -> idea');
    for (const r of rows.revenue_entries) if (r.deal_id) assert.ok(dealIds.has(r.deal_id), 'invoice -> deal');
  });

  it('exercises the agent: stale idea, unmeasured posts, stale deal, overdue invoice, slipped schedule', () => {
    const data = makeData({
      ideas: rows.ideas as unknown as Idea[],
      posts: rows.posts as unknown as Post[],
      deals: rows.deals.map((d) => ({ ...d, stage_updated_at: d.stage_updated_at })) as unknown as Deal[],
      revenue: rows.revenue_entries.map((r) => ({ ...r, created_at: NOW.toISOString() })) as unknown as RevenueEntry[],
    });
    const keys = runChecks(data, NOW).flags.map((f) => f.key);
    for (const k of ['ideas_stale', 'posts_unmeasured', 'deals_stale', 'invoices_overdue', 'schedule_slipped']) {
      assert.ok(keys.includes(k), `expected ${k}`);
    }
  });
});
