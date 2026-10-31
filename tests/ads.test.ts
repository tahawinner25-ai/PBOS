import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adAsText, adIssues, validateAdVariants, type AdVariant } from '../src/lib/ads';
import { generateAds } from '../src/lib/ads-generate';
import type { LlmCall } from '../src/lib/agent/llm';
import type { CreatorProfile } from '../src/lib/types';

const ctx = { format: 'meta_feed' as const, offer: 'My 4-week editing course. Launch price $49 until Friday.', allowedNumbers: new Set([4, 49]) };
const good: AdVariant = { angle: 'Benefit', headline: 'Edit faster, calmer', primary_text: 'A 4-week course for creators who want a repeatable editing workflow.', description: 'Launch price $49', cta: 'Learn more' };

test('a clean variant has no issues', () => assert.deepEqual(adIssues(good, ctx), []));

test('lengths are enforced per format', () => {
  assert.match(adIssues({ ...good, headline: 'x'.repeat(41) }, ctx).join(' '), /headline is 41/);
  assert.match(adIssues({ ...good, primary_text: 'y'.repeat(126) }, ctx).join(' '), /126 characters/);
  const yt = { format: 'youtube_video' as const, offer: ctx.offer, allowedNumbers: ctx.allowedNumbers };
  assert.match(adIssues({ ...good, headline: 'z'.repeat(31), cta: 'Learn more' }, yt).join(' '), /allows 30/);
  const reels = { format: 'meta_reels' as const, offer: ctx.offer, allowedNumbers: ctx.allowedNumbers };
  assert.match(adIssues({ ...good, primary_text: 'ok text', description: 'not shown' }, reels).join(' '), /do not show a description/);
});

test('the button must come from the platform list', () => assert.match(adIssues({ ...good, cta: 'Click here!!' }, ctx).join(' '), /button must be one of/));

test('invented numbers, guarantees and fake social proof are rejected', () => {
  assert.match(adIssues({ ...good, headline: 'Save 70% today' }, ctx).join(' '), /unsupported number 70/);
  assert.match(adIssues({ ...good, primary_text: 'We guarantee you will love it' }, ctx).join(' '), /guarantee/);
  assert.match(adIssues({ ...good, primary_text: 'Trusted by creators everywhere' }, ctx).join(' '), /invents social proof/);
  assert.ok(adIssues({ ...good, primary_text: 'The #1 editing course' }, ctx).length > 0, '#1 is rejected, as an unsupported number or as invented social proof');
  assert.match(adIssues({ ...good, primary_text: 'See the before and after' }, ctx).join(' '), /before-and-after/);
  assert.match(adIssues({ ...good, primary_text: 'Are you struggling with edits?' }, ctx).join(' '), /personal attribute/);
  assert.match(adIssues({ ...good, primary_text: 'This will cure your burnout' }, ctx).join(' '), /health claim/);
  assert.match(adIssues({ ...good, primary_text: 'Make passive income with it' }, ctx).join(' '), /income|passive/);
  assert.match(adIssues({ ...good, primary_text: 'Click <b>now</b>' }, ctx).join(' '), /< or >/);
});

test('urgency is allowed only when the offer states it', () => {
  assert.match(adIssues({ ...good, primary_text: 'Last chance to join the course' }, ctx).join(' '), /urgency/);
  const urgent = { ...ctx, offer: `${ctx.offer} Last chance on Friday.` };
  assert.deepEqual(adIssues({ ...good, primary_text: 'Last chance to join the course' }, urgent), []);
});

test('model output: exactly three distinct, valid variants', () => {
  const v2: AdVariant = { angle: 'Problem', headline: 'Stop re-cutting clips', primary_text: 'Build one editing routine and keep it. Four weeks, one project.', description: '', cta: 'Sign up' };
  const v3: AdVariant = { angle: 'Question', headline: 'Ready for a routine?', primary_text: 'What if every edit started from a plan? This course gives you one.', description: '', cta: 'Learn more' };
  assert.equal(validateAdVariants({ variants: [good, v2, v3] }, ctx).ok, true);
  assert.equal(validateAdVariants({ variants: [good, v2] }, ctx).ok, false);
  assert.equal(validateAdVariants({ variants: [good, good, v3] }, ctx).ok, false);
  assert.equal(validateAdVariants({ variants: [good, { ...v2, angle: 'benefit' }, v3] }, ctx).ok, false);
  assert.equal(validateAdVariants('nope', ctx).ok, false);
  const bad = validateAdVariants({ variants: [{ ...good, headline: 'Win 500 dollars' }, v2, v3] }, ctx);
  assert.equal(bad.ok, false);
});

const profile = { id: 'p', user_id: 'u', name: 'Sam', niche: 'video editing', positioning: null, voice: 'plain', goals: {}, audience_notes: 'beginner editors', services: [], rate_card: [], faq: [], ai_persona: null, media_kit_published: false, avatar_path: null, created_at: '', updated_at: '' } as unknown as CreatorProfile;

test('generateAds retries once with the rejection reasons, then succeeds', async () => {
  const v2 = { angle: 'Problem', headline: 'Stop re-cutting clips', primary_text: 'Build one editing routine and keep it. Four weeks, one project.', description: '', cta: 'Sign up' };
  const v3 = { angle: 'Question', headline: 'Ready for a routine?', primary_text: 'What if every edit started from a plan? This course gives you one.', description: '', cta: 'Learn more' };
  const prompts: string[] = [];
  let n = 0;
  const llm: LlmCall = async ({ user }) => { prompts.push(user); n += 1; const json = n === 1 ? { variants: [{ ...good, headline: 'Guaranteed viral' }, v2, v3] } : { variants: [good, v2, v3] }; return { ok: true, json, text: JSON.stringify(json) }; };
  const r = await generateAds(llm, profile, { format: 'meta_feed', objective: 'Get sign-ups', offer: ctx.offer, audience: 'beginner editors' });
  assert.equal(r.ok, true);
  assert.equal(n, 2);
  assert.match(prompts[1], /rejected for these reasons/);
});

test('generateAds reports an unavailable model plainly and never fabricates', async () => {
  const llm: LlmCall = async () => ({ ok: false, reason: 'not_configured' });
  const r = await generateAds(llm, profile, { format: 'meta_feed', objective: 'Get sign-ups', offer: ctx.offer, audience: 'x' });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'ai_unavailable');
});

test('paste-ready text', () => assert.match(adAsText(good, 'meta_feed'), /Headline: Edit faster, calmer\nPrimary text: .*\nDescription: Launch price \$49\nButton: Learn more/));
