import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeDaily, buildDailyPlan, buildLlmContext, buildLlmUserMessage, type DailyPlan } from '../src/lib/agent/daily';
import type { LlmCall, LlmResult } from '../src/lib/agent/llm';
import { SYSTEM_PROMPT, staticSystemBlock } from '../src/lib/agent/prompt';
import type { AgentData } from '../src/lib/agent/types';
import { NOW, daysAgo, dateOnly, makeData, makeDeal, makeEvent, makeIdea, makeInvoice, makePost } from './fixtures';

function scenario() {
  const deal = makeDeal({ stage: 'negotiating', stage_updated_at: daysAgo(9) });
  const inv = makeInvoice({ status: 'overdue', due_date: dateOnly(9), deal_id: deal.id });
  const posts = [makePost(), makePost()];
  const data = makeData({ deals: [deal], revenue: [inv], posts });
  return { data, deal, inv, posts };
}

/** Build a model answer that mirrors the plan, so we can mutate it per test. */
function goodAnswer(plan: DailyPlan) {
  const intent = plan.draftIntent!;
  const ctx = intent.context as { invoice: { amount: number; days_overdue: number } };
  return {
    flags: plan.flags.map((f) => ({ pillar: f.pillar, message: f.message, source_record_ids: f.source_record_ids })),
    recommendations: plan.top.map((c) => ({
      pillar: c.pillar,
      action: c.action,
      reason: c.reason,
      source_record_ids: c.source_record_ids,
    })),
    draft: {
      type: intent.draftType,
      platform: intent.platform,
      content: `Subject: Following up on the invoice\n\nHi Priya,\n\nThe invoice for ${ctx.invoice.amount} is now ${ctx.invoice.days_overdue} days overdue. Could you confirm when to expect payment?\n\nThanks,\nSam Rivera`,
    },
  };
}

const llmReturning = (json: unknown): LlmCall => async () => ({ ok: true, json, text: JSON.stringify(json) });
const llmFailing = (reason: Extract<LlmResult, { ok: false }>['reason']): LlmCall => async () => ({ ok: false, reason });

describe('daily plan', () => {
  it('ranks, caps recommendations at three and picks one draft', () => {
    const { data } = scenario();
    const plan = buildDailyPlan(
      { ...data, ideas: [makeIdea({ created_at: daysAgo(30) })], profile: { ...data.profile, voice: null } },
      NOW,
    );
    assert.ok(plan.top.length <= 3);
    assert.equal(plan.top[0].key, 'invoices_overdue');
    assert.equal(plan.draftIntent?.key, 'invoices_overdue');
    assert.ok(plan.flags.length >= 4);
  });

  it('sends only the variable context needed, with no contact email and no unrelated records', () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    const message = buildLlmUserMessage(plan, data);
    assert.ok(!message.includes('priya@example.com'));
    const ctx = buildLlmContext(plan, data);
    const ids = (ctx.records as Array<{ id: string }>).map((r) => r.id);
    assert.ok(ids.every((id) => plan.allowedIds.has(id)));
    const unrelated = makeIdea({ created_at: daysAgo(1) });
    const bigger = buildLlmContext(buildDailyPlan({ ...data, ideas: [unrelated] }, NOW), { ...data, ideas: [unrelated] });
    assert.ok(!JSON.stringify(bigger).includes(unrelated.id));
  });

  it('puts the exact spec system prompt in the static, cacheable block', () => {
    const { data } = scenario();
    assert.ok(staticSystemBlock(data.profile).startsWith(SYSTEM_PROMPT));
    assert.ok(SYSTEM_PROMPT.includes('Be an operator, not a hype machine.'));
  });
});

describe('analyzeDaily', () => {
  it('accepts a valid model answer and keeps the deterministic source ids', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    const res = await analyzeDaily(plan, data, llmReturning(goodAnswer(plan)));
    assert.equal(res.status, 'ok');
    assert.equal(res.source, 'llm');
    assert.equal(res.recommendations.length, plan.top.length);
    assert.ok(res.recommendations.every((r) => r.source_record_ids.length > 0 && r.key));
    assert.equal(res.draft?.type, 'email');
    assert.equal(res.draft?.platform, 'Email');
  });

  it('rejects an answer containing an unsupported number and falls back safely', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    const bad = goodAnswer(plan);
    bad.recommendations[0].reason = 'This client pays 9,999 and reached 250000 people last month.';
    const res = await analyzeDaily(plan, data, llmReturning(bad));
    assert.equal(res.status, 'fallback');
    assert.equal(res.source, 'rules');
    assert.equal(res.draft, null);
    assert.equal(res.fallback?.reason, 'invalid_output');
    assert.ok(res.fallback?.details?.some((d) => d.includes('unsupported number 9999')));
    assert.match(res.fallback!.message, /rejected, not shown/);
    assert.equal(res.recommendations.length, plan.top.length);
  });

  it('rejects recommendations that cite records the model was never given', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    const bad = goodAnswer(plan);
    bad.recommendations[0].source_record_ids = ['99999999-9999-4999-8999-999999999999'];
    const res = await analyzeDaily(plan, data, llmReturning(bad));
    assert.equal(res.status, 'fallback');
    assert.ok(res.fallback?.details?.some((d) => /unknown record ids/.test(d)));
  });

  it('rejects invented recommendations, missing sources and promises of outcomes', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);

    const invented = goodAnswer(plan);
    invented.recommendations[0].pillar = 'Ideation';
    assert.equal((await analyzeDaily(plan, data, llmReturning(invented))).status, 'fallback');

    const noSource = goodAnswer(plan);
    noSource.recommendations[0].source_record_ids = [];
    assert.equal((await analyzeDaily(plan, data, llmReturning(noSource))).status, 'fallback');

    const promise = goodAnswer(plan);
    promise.recommendations[0].reason = 'Follow up and this will guarantee payment.';
    const res = await analyzeDaily(plan, data, llmReturning(promise));
    assert.equal(res.status, 'fallback');
    assert.ok(res.fallback?.details?.some((d) => /guarantees an outcome/.test(d)));
  });

  it('rejects drafts with binding legal language or the wrong type', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    const legal = goodAnswer(plan);
    legal.draft.content += '\n\nPayment is hereby due under the governing law of the agreement.';
    assert.equal((await analyzeDaily(plan, data, llmReturning(legal))).status, 'fallback');

    const wrongType = goodAnswer(plan);
    wrongType.draft.type = 'caption' as never;
    assert.equal((await analyzeDaily(plan, data, llmReturning(wrongType))).status, 'fallback');
  });

  it('rejects incomplete and non-object answers', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    assert.equal((await analyzeDaily(plan, data, llmReturning({ flags: [] }))).status, 'fallback');
    assert.equal((await analyzeDaily(plan, data, llmReturning('nope'))).status, 'fallback');
    assert.equal((await analyzeDaily(plan, data, llmReturning(null))).status, 'fallback');
  });

  it('falls back with a clear message when the AI is unavailable', async () => {
    const { data } = scenario();
    const plan = buildDailyPlan(data, NOW);
    for (const reason of ['not_configured', 'timeout', 'network', 'http_error', 'bad_json', 'empty'] as const) {
      const res = await analyzeDaily(plan, data, llmFailing(reason));
      assert.equal(res.status, 'fallback');
      assert.equal(res.fallback?.reason, reason);
      assert.ok(res.recommendations.length > 0, 'rule-based recommendations still returned');
      assert.equal(res.draft, null);
    }
  });

  it('does not call the model and shows an empty state when there is no data', async () => {
    const data = makeData();
    let called = false;
    const res = await analyzeDaily(buildDailyPlan(data, NOW), data, async () => {
      called = true;
      return { ok: false, reason: 'not_configured' };
    });
    assert.equal(res.status, 'no_data');
    assert.equal(called, false);
    assert.deepEqual(res.recommendations, []);
    assert.equal(res.draft, null);
  });

  it('reports "clear" when records exist but nothing is flagged', async () => {
    const data = makeData({ ideas: [makeIdea({ created_at: daysAgo(1) })] });
    const res = await analyzeDaily(buildDailyPlan(data, NOW), data, llmFailing('not_configured'));
    assert.equal(res.status, 'clear');
    assert.match(res.message ?? '', /All checks passed/);
  });

  it('learns: a recommendation ignored twice is paused but its flag remains', async () => {
    const { data } = scenario();
    const events: AgentData['events'] = [
      makeEvent({ type: 'ignored', pillar: 'Revenue', payload: { key: 'invoices_overdue', action: 'Send the final notice' }, created_at: daysAgo(3) }),
      makeEvent({ type: 'ignored', pillar: 'Revenue', payload: { key: 'invoices_overdue', action: 'Send the final notice' }, created_at: daysAgo(1) }),
    ];
    const plan = buildDailyPlan({ ...data, events }, NOW);
    assert.ok(!plan.top.some((c) => c.key === 'invoices_overdue'));
    assert.ok(plan.flags.some((f) => f.key === 'invoices_overdue'));
    assert.ok(plan.feedback.notes.some((n) => /ignored/.test(n)));
    assert.notEqual(plan.draftIntent?.key, 'invoices_overdue');
  });
});
