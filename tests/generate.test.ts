import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LlmCall } from '../src/lib/agent/llm';
import { scanText } from '../src/lib/agent/validate';
import {
  generateCaption,
  generateFollowups,
  generateHooks,
  generateMediaKit,
  generateOutreach,
} from '../src/lib/generate';
import { followupTemplates, outreachTemplate } from '../src/lib/generate/templates';
import { NOW, dateOnly, makeDeal, makeInvoice, makeProfile } from './fixtures';

const returning = (...answers: unknown[]): { llm: LlmCall; calls: () => number; prompts: string[] } => {
  let i = 0;
  const prompts: string[] = [];
  return {
    llm: async ({ user }) => {
      prompts.push(user);
      const json = answers[Math.min(i, answers.length - 1)];
      i += 1;
      return { ok: true, json, text: JSON.stringify(json) };
    },
    calls: () => i,
    prompts,
  };
};
const down: LlmCall = async () => ({ ok: false, reason: 'not_configured' });
const profile = makeProfile();

const CORE = 'Why freelancers should pay themselves a salary';

describe('hook variants', () => {
  const good = {
    variants: [
      { angle: 'Contrarian', hook: 'Stop chasing invoices. Start running payroll for yourself.' },
      { angle: 'Story', hook: 'The month my income swung wildly taught me one thing about cash buffers.' },
      { angle: 'How-to', hook: 'Set up a monthly transfer so your account behaves like a paycheck.' },
    ],
  };

  it('accepts three distinct angles', async () => {
    const r = await generateHooks(returning(good).llm, profile, { hook: CORE, platform: 'Instagram', format: 'Carousel' });
    assert.ok(r.ok);
    assert.equal(r.ok && r.value.variants.length, 3);
  });

  it('rejects minor rewordings, retries once with the reasons, then fails without saving', async () => {
    const reworded = {
      variants: [
        { angle: 'A', hook: 'Why freelancers should pay themselves a real salary' },
        { angle: 'B', hook: 'Why every freelancer should pay themselves a salary' },
        { angle: 'C', hook: 'Why freelancers need to pay themselves a salary' },
      ],
    };
    const src = returning(reworded);
    const r = await generateHooks(src.llm, profile, { hook: CORE, platform: null, format: null });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.code, 'invalid_output');
    assert.equal(src.calls(), 2);
    assert.match(src.prompts[1], /previous answer was rejected/);
  });

  it('rejects invented numbers and a wrong variant count', async () => {
    const invented = { variants: good.variants.map((v, i) => (i === 0 ? { ...v, hook: 'How I earned 50000 in a month as a freelancer' } : v)) };
    assert.equal((await generateHooks(returning(invented).llm, profile, { hook: CORE, platform: null, format: null })).ok, false);
    assert.equal((await generateHooks(returning({ variants: good.variants.slice(0, 2) }).llm, profile, { hook: CORE, platform: null, format: null })).ok, false);
  });

  it('reports AI unavailable instead of inventing hooks', async () => {
    const r = await generateHooks(down, profile, { hook: CORE, platform: null, format: null });
    assert.equal(!r.ok && r.code, 'ai_unavailable');
  });
});

describe('platform captions', () => {
  const input = { coreMessage: 'Paying yourself a fixed salary smooths out freelance income and makes budgeting easier.', platform: 'X', format: 'Text post', angle: 'Lead with the feast-or-famine feeling', avoid: [] as string[] };

  it('accepts an adapted caption within the platform limit', async () => {
    const r = await generateCaption(returning({ caption: 'Feast-or-famine months are a system problem. Fix it with a fixed monthly salary from your business account.', structure: 'single claim' }).llm, profile, input);
    assert.ok(r.ok);
  });

  it('rejects over-length captions (X limit) and direct duplication', async () => {
    const long = { caption: 'Fix your cash flow. '.repeat(30) };
    assert.equal((await generateCaption(returning(long).llm, profile, input)).ok, false);
    const copy = { caption: input.coreMessage };
    assert.equal((await generateCaption(returning(copy).llm, profile, input)).ok, false);
  });

  it('rejects a caption that duplicates one already written for another platform', async () => {
    const other = 'Feast-or-famine months are a system problem. Fix it with a fixed monthly salary from your business account.';
    const r = await generateCaption(returning({ caption: other }).llm, profile, { ...input, avoid: [other] });
    assert.equal(r.ok, false);
  });
});

describe('outreach email', () => {
  const deal = makeDeal({ stage: 'negotiating', deliverables: ['one sponsored short video', 'two story frames'] });

  it('accepts a short brand-specific email', async () => {
    const body = 'Hi Priya,\n\nFollowing up on the Northwind Audio collaboration. Is there anything you still need from me on the sponsored short video or the story frames?\n\nThanks,\nSam Rivera';
    const r = await generateOutreach(returning({ subject: 'Next steps with Northwind Audio', body }).llm, profile, deal, NOW);
    assert.ok(r.ok && r.source === 'ai');
  });

  it('falls back to a clearly labelled template built from real records when the AI fails', async () => {
    const r = await generateOutreach(down, profile, deal, NOW);
    assert.ok(r.ok);
    assert.equal(r.ok && r.source, 'template');
    assert.match(r.ok ? (r.notice ?? '') : '', /template/);
    assert.ok(r.ok && r.value.body.includes('Hi Priya,'));
    assert.ok(r.ok && r.value.body.includes('- one sponsored short video'));
    assert.ok(r.ok && r.value.body.trim().endsWith('Sam Rivera'));
  });

  it('falls back when the model makes an unsupported claim', async () => {
    const r = await generateOutreach(
      returning({ subject: 'Northwind Audio', body: 'Hi Priya, Northwind Audio will earn 10x returns and I guarantee viral reach for the sponsored video. Let me know.' }).llm,
      profile,
      deal,
      NOW,
    );
    assert.equal(r.ok && r.source, 'template');
  });

  it('templates exist for every stage and pass the same safety scan', () => {
    for (const stage of ['prospecting', 'negotiating', 'contracted', 'delivery', 'paid'] as const) {
      const t = outreachTemplate(profile, makeDeal({ stage, deliverables: [] }));
      const allowed = new Set<number>([1, 2, 3]);
      assert.deepEqual(scanText(`${t.subject}\n${t.body}`, allowed), [], stage);
      assert.ok(t.subject.includes('Northwind Audio'));
    }
  });
});

describe('invoice follow-ups', () => {
  const deal = makeDeal();
  const invoice = makeInvoice({ status: 'overdue', amount: 1500, due_date: dateOnly(16), deal_id: deal.id });

  it('produces three escalating, non-threatening templates from real invoice data', () => {
    const drafts = followupTemplates(profile, invoice, deal, NOW);
    assert.deepEqual(drafts.map((d) => d.label), ['Friendly reminder', 'Direct follow-up', 'Final notice']);
    assert.deepEqual(drafts.map((d) => d.level), [1, 2, 3]);
    for (const d of drafts) {
      assert.ok(d.body.includes('$1,500'), d.label);
      assert.ok(d.body.includes('[payment details]'), d.label);
      assert.deepEqual(scanText(`${d.subject}\n${d.body}`, new Set([1500, 16, 2026, 10, 14, 28])), [], d.label);
    }
    assert.ok(drafts[1].body.includes('16 days past due'));
    assert.ok(!/legal|lawyer|collections|fee|penalt/i.test(drafts.map((d) => d.body).join(' ')));
  });

  it('uses templates, labelled as such, when the AI is unavailable, and suggests the level from days overdue', async () => {
    const r = await generateFollowups(down, profile, invoice, deal, NOW);
    assert.ok(r.ok);
    assert.equal(r.ok && r.source, 'template');
    assert.equal(r.ok && r.value.suggested_level, 3);
    assert.equal(r.ok && r.value.drafts.length, 3);
  });

  it('rejects AI drafts with legal threats and keeps the templates', async () => {
    const threat = {
      drafts: [1, 2, 3].map((level) => ({
        level,
        subject: 'Invoice reminder',
        body: 'Hi, please pay the invoice for $1,500 soon. Otherwise we will take legal action against you for non-payment.',
      })),
    };
    const r = await generateFollowups(returning(threat).llm, profile, invoice, deal, NOW);
    assert.equal(r.ok && r.source, 'template');
  });
});

describe('media kit proposals', () => {
  it('asks the creator to complete missing positioning instead of guessing', async () => {
    const src = returning({});
    const r = await generateMediaKit(src.llm, makeProfile({ positioning: null, niche: null }));
    assert.equal(!r.ok && r.code, 'missing_profile');
    assert.equal(src.calls(), 0);
    assert.ok(!r.ok && (r.missing?.length ?? 0) > 0);
  });

  it('accepts proposals grounded in the profile', async () => {
    const r = await generateMediaKit(
      returning({
        positioning_line: 'Calm, practical money habits for freelancers.',
        services: [{ name: 'Sponsored video', description: 'One dedicated short video with an honest, clearly disclosed sponsorship.' }],
        faq: [{ q: 'Do you disclose sponsorships?', a: 'Yes, every sponsored post is clearly disclosed.' }],
      }).llm,
      profile,
    );
    assert.ok(r.ok);
  });

  it('rejects invented audience numbers', async () => {
    const r = await generateMediaKit(
      returning({ positioning_line: 'Trusted by 250000 freelancers.', services: [], faq: [] }).llm,
      profile,
    );
    assert.equal(r.ok, false);
  });
});
