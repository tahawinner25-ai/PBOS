import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runChecks, selectDraftIntent } from '../src/lib/agent/checks';
import { NOW, daysAgo, dateOnly, makeData, makeDeal, makeIdea, makeInvoice, makePost, makeProfile, measured } from './fixtures';

const keys = (r: ReturnType<typeof runChecks>) => r.flags.map((f) => f.key);

describe('deterministic checks', () => {
  it('flags nothing for a complete profile with no records', () => {
    assert.deepEqual(runChecks(makeData(), NOW).flags, []);
  });

  it('flags ideas in "idea" status for more than 7 days, not exactly 7', () => {
    const stale = makeIdea({ created_at: daysAgo(8) });
    const edge = makeIdea({ created_at: daysAgo(7) });
    const fresh = makeIdea({ created_at: daysAgo(6) });
    const scripted = makeIdea({ created_at: daysAgo(30), status: 'scripted' });
    const r = runChecks(makeData({ ideas: [stale, edge, fresh, scripted] }), NOW);
    const flag = r.flags.find((f) => f.key === 'ideas_stale');
    assert.ok(flag);
    assert.deepEqual(flag.source_record_ids, [stale.id]);
    assert.match(flag.message, /1 idea has sat in "idea" status for more than 7 days \(oldest: 8 days\)/);
  });

  it('flags posts with no metrics and cites their ids', () => {
    const a = makePost();
    const b = makePost();
    const withMetrics = makePost({ views: 100 });
    const future = makePost({ published_at: new Date(NOW.getTime() + 86_400_000).toISOString() });
    const r = runChecks(makeData({ posts: [a, b, withMetrics, future] }), NOW);
    const flag = r.flags.find((f) => f.key === 'posts_unmeasured');
    assert.ok(flag);
    assert.equal(flag.pillar, 'Analytics');
    assert.deepEqual(new Set(flag.source_record_ids), new Set([a.id, b.id]));
    assert.match(flag.message, /^2 recent posts have no performance data$/);
    const cand = r.candidates.find((c) => c.key === 'posts_unmeasured');
    assert.match(cand!.reason, /Pattern detection is blocked without engagement data/);
  });

  it('flags deals idle in the same stage for more than 7 days and ignores paid deals', () => {
    const stale = makeDeal({ stage: 'negotiating', stage_updated_at: daysAgo(9) });
    const fresh = makeDeal({ stage_updated_at: daysAgo(3) });
    const paid = makeDeal({ stage: 'paid', stage_updated_at: daysAgo(60) });
    const r = runChecks(makeData({ deals: [stale, fresh, paid] }), NOW);
    const flag = r.flags.find((f) => f.key === 'deals_stale');
    assert.deepEqual(flag?.source_record_ids, [stale.id]);
    const cand = r.candidates.find((c) => c.key === 'deals_stale');
    assert.match(cand!.action, /Follow up with Northwind Audio \(in "negotiating" for 9 days\)/);
    assert.match(cand!.reason, /\$4,500/);
  });

  it('flags overdue invoices: explicit overdue and invoiced-past-due, not paid', () => {
    const marked = makeInvoice({ status: 'overdue', due_date: dateOnly(3) });
    const pastDue = makeInvoice({ status: 'invoiced', due_date: dateOnly(16) });
    const notDue = makeInvoice({ status: 'invoiced', due_date: dateOnly(-5) });
    const paid = makeInvoice({ status: 'paid', due_date: dateOnly(40) });
    const r = runChecks(makeData({ revenue: [marked, pastDue, notDue, paid] }), NOW);
    const flag = r.flags.find((f) => f.key === 'invoices_overdue');
    assert.deepEqual(new Set(flag?.source_record_ids), new Set([marked.id, pastDue.id]));
    const cand = r.candidates.find((c) => c.key === 'invoices_overdue');
    assert.match(cand!.action, /final notice/);
    assert.match(cand!.action, /16 days overdue/);
  });

  it('flags a high-performing format with no related open idea', () => {
    const posts = [
      measured({ format: 'Carousel' }, 1000, 90),
      measured({ format: 'Carousel' }, 1000, 80),
      measured({ format: 'Short video' }, 1000, 20),
    ];
    const without = runChecks(makeData({ posts }), NOW);
    const flag = without.flags.find((f) => f.key === 'format_followup');
    assert.ok(flag, 'expected format_followup flag');
    assert.match(flag.message, /Carousel is your top format/);

    const withIdea = runChecks(makeData({ posts, ideas: [makeIdea({ format: 'Carousel', status: 'scripted' })] }), NOW);
    assert.ok(!keys(withIdea).includes('format_followup'));
  });

  it('does not claim a best format without enough data', () => {
    const posts = [measured({ format: 'Carousel' }, 1000, 90), measured({ format: 'Short video' }, 1000, 20)];
    assert.ok(!keys(runChecks(makeData({ posts }), NOW)).includes('format_followup'));
  });

  it('asks one targeted question when profile data is missing', () => {
    const profile = makeProfile({ positioning: null });
    const r = runChecks(makeData({ profile }), NOW);
    const cand = r.candidates.find((c) => c.key === 'profile_missing');
    assert.ok(cand);
    assert.match(cand.action, /^Answer one question in Settings: In one sentence, who do you help and how\?$/);
    assert.deepEqual(cand.source_record_ids, ['profile:positioning']);
  });

  it('flags scheduled ideas that slipped past their date', () => {
    const slipped = makeIdea({ status: 'scheduled', scheduled_for: dateOnly(2) });
    const upcoming = makeIdea({ status: 'scheduled', scheduled_for: dateOnly(-2) });
    const r = runChecks(makeData({ ideas: [slipped, upcoming] }), NOW);
    const flag = r.flags.find((f) => f.key === 'schedule_slipped');
    assert.deepEqual(flag?.source_record_ids, [slipped.id]);
    assert.equal(flag?.pillar, 'Posting');
  });

  it('ranks overdue invoices above stale deals above unmeasured posts', () => {
    const data = makeData({
      posts: [makePost()],
      deals: [makeDeal({ stage_updated_at: daysAgo(10) })],
      revenue: [makeInvoice({ status: 'overdue', due_date: dateOnly(5) })],
    });
    const order = runChecks(data, NOW).candidates.map((c) => c.key);
    assert.deepEqual(order.slice(0, 3), ['invoices_overdue', 'deals_stale', 'posts_unmeasured']);
  });

  it('never cites an id that is not a real record or a profile field', () => {
    const data = makeData({
      ideas: [makeIdea({ created_at: daysAgo(20) })],
      posts: [makePost()],
      deals: [makeDeal({ stage_updated_at: daysAgo(20) })],
      revenue: [makeInvoice({ status: 'overdue' })],
      profile: makeProfile({ voice: null }),
    });
    const real = new Set<string>([
      ...data.ideas.map((x) => x.id),
      ...data.posts.map((x) => x.id),
      ...data.deals.map((x) => x.id),
      ...data.revenue.map((x) => x.id),
    ]);
    for (const f of runChecks(data, NOW).flags) {
      assert.ok(f.source_record_ids.length > 0, `${f.key} has no sources`);
      for (const id of f.source_record_ids) assert.ok(real.has(id) || id.startsWith('profile:'), `${f.key}: unknown id ${id}`);
    }
  });
});

describe('draft selection', () => {
  it('prefers the overdue-invoice email over everything else', () => {
    const deal = makeDeal({ stage: 'negotiating', stage_updated_at: daysAgo(20) });
    const inv = makeInvoice({ status: 'overdue', due_date: dateOnly(9), deal_id: deal.id });
    const data = makeData({ deals: [deal], revenue: [inv], ideas: [makeIdea({ created_at: daysAgo(20) })] });
    const active = new Set(['invoices_overdue', 'deals_stale', 'ideas_stale']);
    const intent = selectDraftIntent(data, active, NOW);
    assert.equal(intent?.task, 'invoice_followup');
    assert.equal(intent?.draftType, 'email');
    assert.deepEqual(intent?.source_record_ids, [inv.id, deal.id]);
  });

  it('falls back to a script for the oldest stale idea', () => {
    const idea = makeIdea({ created_at: daysAgo(12) });
    const intent = selectDraftIntent(makeData({ ideas: [idea] }), new Set(['ideas_stale']), NOW);
    assert.equal(intent?.task, 'script');
    assert.deepEqual(intent?.source_record_ids, [idea.id]);
  });

  it('returns null when nothing is draftable or the key is suppressed', () => {
    const data = makeData({ revenue: [makeInvoice({ status: 'overdue' })] });
    assert.equal(selectDraftIntent(data, new Set(), NOW), null);
    assert.equal(selectDraftIntent(makeData({ posts: [makePost()] }), new Set(['posts_unmeasured']), NOW), null);
  });
});
