import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { engagementRate, hasAnyMetric, summarizeAnalytics } from '../src/lib/metrics';
import { daysOverdue, effectiveStatus, followUpLevel, revenueTotals, weightedPipeline } from '../src/lib/revenue';
import { FORECAST_LABEL, STAGE_PROBABILITY } from '../src/lib/constants';
import { NOW, dateOnly, makeDeal, makeInvoice, makePost, measured } from './fixtures';

describe('engagement metrics', () => {
  it('treats all-null metrics as unmeasured and zero as measured', () => {
    assert.equal(hasAnyMetric(makePost()), false);
    assert.equal(hasAnyMetric(makePost({ views: 0 })), true);
  });

  it('computes (likes+comments+shares+saves)/views and refuses to guess without views', () => {
    assert.equal(engagementRate(makePost({ views: 1000, likes: 40, comments: 5, shares: 3, saves: 2, clicks: 99 })), 0.05);
    assert.equal(engagementRate(makePost({ likes: 10 })), null);
    assert.equal(engagementRate(makePost({ views: 0, likes: 10 })), null);
  });

  it('shows what to log next when data is insufficient, with no best-of claims', () => {
    const s = summarizeAnalytics([makePost(), measured({ format: 'Carousel' }), measured({ format: 'Short video' })]);
    assert.equal(s.sufficient, false);
    assert.equal(s.bestFormat, null);
    assert.equal(s.bestPlatform, null);
    assert.equal(s.insights.length, 1);
    assert.ok(s.needs.some((n) => /Log metrics for 1 unmeasured post/.test(n)));
    assert.ok(s.needs.some((n) => /1 more post/.test(n)));
  });

  it('finds the best format and platform with enough data, and every insight ends in a recommendation', () => {
    const posts = [
      measured({ format: 'Carousel', platform: 'Instagram' }, 1000, 90),
      measured({ format: 'Carousel', platform: 'Instagram' }, 1000, 70),
      measured({ format: 'Short video', platform: 'TikTok' }, 1000, 20),
    ];
    const s = summarizeAnalytics(posts);
    assert.equal(s.sufficient, true);
    assert.equal(s.bestFormat?.key, 'Carousel');
    assert.equal(s.bestPlatform?.key, 'Instagram');
    assert.equal(Number(((s.avgRate ?? 0) * 100).toFixed(2)), 6.0);
    assert.ok(s.insights.length >= 3);
    for (const i of s.insights) {
      assert.ok(i.recommendation.length > 20, i.id);
      assert.ok(i.source_record_ids.length > 0, i.id);
    }
    assert.match(s.insights[0].detail, /Carousel averages 8\.0% engagement across 2 posts/);
  });

  it('flags posts that have interactions but no views', () => {
    const s = summarizeAnalytics([makePost({ likes: 5 })]);
    assert.equal(s.partial.length, 1);
    assert.ok(s.needs.some((n) => /view counts/.test(n)));
  });
});

describe('revenue', () => {
  it('derives effective status from due dates', () => {
    assert.equal(effectiveStatus({ status: 'invoiced', due_date: dateOnly(1) }, NOW), 'overdue');
    assert.equal(effectiveStatus({ status: 'invoiced', due_date: dateOnly(-1) }, NOW), 'invoiced');
    assert.equal(effectiveStatus({ status: 'invoiced', due_date: null }, NOW), 'invoiced');
    assert.equal(effectiveStatus({ status: 'paid', due_date: dateOnly(30) }, NOW), 'paid');
    assert.equal(effectiveStatus({ status: 'overdue', due_date: null }, NOW), 'overdue');
  });

  it('counts days overdue and picks the escalation level', () => {
    assert.equal(daysOverdue({ due_date: dateOnly(9) }, NOW), 9);
    assert.equal(daysOverdue({ due_date: dateOnly(-3) }, NOW), 0);
    assert.deepEqual([0, 6, 7, 13, 14, 40].map(followUpLevel), [1, 1, 2, 2, 3, 3]);
  });

  it('totals per currency without mixing currencies; outstanding includes overdue', () => {
    const totals = revenueTotals(
      [
        makeInvoice({ status: 'paid', amount: 1000, currency: 'USD' }),
        makeInvoice({ status: 'invoiced', amount: 500, due_date: dateOnly(-5), currency: 'USD' }),
        makeInvoice({ status: 'invoiced', amount: 250, due_date: dateOnly(4), currency: 'USD' }),
        makeInvoice({ status: 'overdue', amount: 100, currency: 'EUR' }),
      ],
      NOW,
    );
    assert.deepEqual(totals, [
      { currency: 'EUR', collected: 0, outstanding: 100, overdue: 100 },
      { currency: 'USD', collected: 1000, outstanding: 750, overdue: 250 },
    ]);
  });

  it('computes weighted pipeline = sum(value × probability) with 10/40/80 weights', () => {
    assert.deepEqual(
      [STAGE_PROBABILITY.prospecting, STAGE_PROBABILITY.negotiating, STAGE_PROBABILITY.contracted],
      [0.1, 0.4, 0.8],
    );
    const wp = weightedPipeline([
      makeDeal({ stage: 'prospecting', value: 1000 }),
      makeDeal({ stage: 'negotiating', value: 2000 }),
      makeDeal({ stage: 'contracted', value: 5000 }),
      makeDeal({ stage: 'delivery', value: 9000 }),
      makeDeal({ stage: 'paid', value: 7000 }),
      makeDeal({ stage: 'negotiating', value: null }),
    ]);
    assert.equal(wp.total, 100 + 800 + 4000);
    assert.equal(wp.dealsWithoutValue, 1);
    assert.deepEqual(wp.excludedStages, ['delivery', 'paid']);
  });

  it('exposes the exact required forecast label', () => {
    assert.equal(FORECAST_LABEL, 'Estimate, not guaranteed income.');
  });

  it('returns zero for an empty pipeline rather than a placeholder', () => {
    assert.equal(weightedPipeline([]).total, 0);
    assert.deepEqual(revenueTotals([], NOW), []);
  });
});
