import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanEditPlan, cleanVideoPlan, handoffHref } from '../src/lib/agent/handoff';
import { toolByName, type ToolCtx } from '../src/lib/agent/tools/specs';

const ID = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';
const MEDIA = '5b5b5b5b-5b5b-4b5b-8b5b-5b5b5b5b5b5b';
const ctx = (nums: number[] = []): ToolCtx => ({ now: new Date('2026-11-10T10:00:00Z'), userNumbers: new Set(nums), allowedNumbers: new Set(nums) });
const parse = (name: string, raw: unknown, c = ctx()) => toolByName(name)!.parse(raw, c);

const scene = (o: Record<string, unknown> = {}) => ({ caption: 'Start small', picture: 'A tidy desk with a laptop at sunrise', seconds: 4, ...o });
const plan = (o: Record<string, unknown> = {}) => ({ topic: 'Three habits for a calmer creative week', title: 'Calmer week', scenes: [scene(), scene({ caption: 'Plan the night before' })], ...o });

test('handoff links carry only a stored row id, and only for plan tools', () => {
  assert.equal(handoffHref('plan_video', ID, '/video'), `/video?plan=${ID}`);
  assert.equal(handoffHref('plan_video', ID, `/video?plan=${ID}`), `/video?plan=${ID}`);
  assert.equal(handoffHref('plan_edit', ID, '/studio'), `/studio?plan=${ID}`);
  assert.equal(handoffHref('create_idea', ID, '/ideas'), '/ideas');
  assert.equal(handoffHref('plan_video', 'not-an-id', '/video'), '/video');
  assert.equal(handoffHref('plan_video', null, '/video'), '/video');
});

test('plan_video: valid plan passes with defaults; limits and unknown fields are refused', () => {
  const ok = cleanVideoPlan(plan());
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(ok.value.shape, '9:16'); assert.equal(ok.value.style, 'photo'); assert.equal(ok.value.scenes[1].motion, 'zoom-out'); }
  assert.ok(!cleanVideoPlan(plan({ scenes: [scene()] })).ok);
  assert.ok(!cleanVideoPlan(plan({ scenes: Array.from({ length: 9 }, () => scene()) })).ok);
  assert.ok(!cleanVideoPlan(plan({ scenes: [scene({ seconds: 20 }), scene()] })).ok);
  assert.ok(!cleanVideoPlan(plan({ scenes: [scene({ extra: 1 }), scene()] })).ok);
  assert.ok(!cleanVideoPlan(plan({ shape: '4:3' })).ok);
  assert.ok(!parse('plan_video', plan({ bogus: true })).ok);
});

test('plan_video: invented figures and outcome promises in captions are refused', () => {
  assert.ok(!parse('plan_video', plan({ scenes: [scene({ caption: 'Get 10,000 followers fast' }), scene()] })).ok);
  assert.ok(!parse('plan_video', plan({ scenes: [scene({ caption: 'This guarantees you more income' }), scene()] })).ok);
  assert.ok(parse('plan_video', plan({ scenes: [scene({ caption: 'Post 3 times a week' }), scene()] }), ctx([3])).ok);
});

test('plan_edit: trims, captions and ids are checked', () => {
  const clip = { media_id: MEDIA, start: 2, end: 12 };
  assert.ok(cleanEditPlan({ clips: [clip] }).ok);
  assert.ok(!cleanEditPlan({ clips: [] }).ok);
  assert.ok(!cleanEditPlan({ clips: [{ ...clip, media_id: 'x' }] }).ok);
  assert.ok(!cleanEditPlan({ clips: [{ ...clip, end: 2.1 }] }).ok);
  assert.ok(!cleanEditPlan({ clips: [{ ...clip, volume: 2 }] }).ok);
  assert.ok(!cleanEditPlan({ clips: [clip], texts: [{ text: 'Hi', start: 5, end: 11 }] }).ok, 'caption past the end of a 10 s edit');
  assert.ok(cleanEditPlan({ clips: [clip], texts: [{ text: 'Hi', start: 0, end: 3, position: 'top' }] }).ok);
  assert.ok(!parse('plan_edit', { clips: [clip], texts: [{ text: 'We grew 5000 views', start: 0, end: 3 }] }).ok);
});

test('add_deal and add_invoice only take money the creator gave', () => {
  assert.ok(parse('add_deal', { brand: 'Acme' }).ok);
  assert.ok(!parse('add_deal', { brand: 'Acme', value: 4000 }).ok);
  assert.ok(parse('add_deal', { brand: 'Acme', value: 4000 }, ctx([4000])).ok);
  assert.ok(!parse('add_invoice', { amount: 900 }).ok);
  assert.ok(parse('add_invoice', { amount: 900, currency: 'usd' }, ctx([900])).ok);
  assert.ok(!parse('add_invoice', { amount: 900, status: 'paid' }, ctx([900])).ok, 'paid needs set_invoice_status with approval');
});

test('update_idea and update_deal are approval-tier and need at least one field', () => {
  assert.equal(toolByName('update_idea')!.tier, 'change');
  assert.equal(toolByName('update_deal')!.tier, 'change');
  assert.ok(!parse('update_idea', { idea_id: ID }).ok);
  assert.ok(parse('update_idea', { idea_id: ID, hook: 'A sharper opening line for this one' }).ok);
  assert.ok(!parse('update_deal', { deal_id: ID, value: 5000 }).ok);
  assert.ok(parse('update_deal', { deal_id: ID, value: 5000 }, ctx([5000])).ok);
  assert.ok(parse('update_deal', { deal_id: ID, value: 5000 }, { ...ctx(), stored: true }).ok);
});
