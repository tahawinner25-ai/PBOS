import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LlmCall } from '../src/lib/agent/llm';
import { planStoryboard } from '../src/lib/storyboard/generate';
import { sceneImageDailyLimit } from '../src/lib/storyboard/limits';
import {
  MOTIONS, STORYBOARD, blankScene, layersAt, motionAt, picturePrompt, sceneOffsets, sceneRect, storyboardIssues, totalSeconds, validateStoryboard, type Scene,
} from '../src/lib/storyboard/plan';
import { drawStoryboardFrame, estimatedBytes, type ScenePicture } from '../src/lib/storyboard/render';
import { makeProfile } from './fixtures';

const scene = (id: string, seconds = 4, over: Partial<Scene> = {}): Scene => ({ id, caption: `caption ${id}`, picture: 'a quiet desk with a laptop and a plant', seconds, motion: 'zoom-in', ...over });

test('scene times add up and each scene starts where the last ended', () => {
  const s = [scene('a', 3), scene('b', 4.5), scene('c', 2)];
  assert.equal(totalSeconds(s), 9.5);
  assert.deepEqual(sceneOffsets(s), [0, 3, 7.5]);
});

test('layersAt draws one scene, and cross-fades into the next at its start', () => {
  const s = [scene('a', 4), scene('b', 4)];
  assert.deepEqual(layersAt(s, 1).map((l) => l.index), [0]);
  const mid = layersAt(s, 4.25);
  assert.deepEqual(mid.map((l) => l.index), [0, 1]);
  assert.equal(mid[0].alpha, 1);
  assert.ok(mid[1].alpha > 0 && mid[1].alpha < 1);
  assert.deepEqual(layersAt(s, 5).map((l) => l.index), [1]);
  assert.deepEqual(layersAt(s, 0).map((l) => l.index), [0], 'the first scene never fades from another scene');
  assert.deepEqual(layersAt([], 1), []);
});

test('layersAt clamps time to the video, so the last frame is the last scene', () => {
  const s = [scene('a', 2), scene('b', 2)];
  assert.equal(layersAt(s, -5)[0].index, 0);
  const end = layersAt(s, 99);
  assert.equal(end[end.length - 1].index, 1);
  assert.ok(end[end.length - 1].progress <= 1);
});

test('the camera is calm: zoom stays within the allowed amount and pan within the picture', () => {
  for (const m of MOTIONS) {
    for (let i = 0; i <= 20; i += 1) {
      const { zoom, pan } = motionAt(m, i / 20);
      assert.ok(zoom >= 1 && zoom <= 1 + STORYBOARD.zoomAmount + 1e-9, `${m} zoom ${zoom}`);
      assert.ok(pan >= -1 - 1e-9 && pan <= 1 + 1e-9, `${m} pan ${pan}`);
    }
  }
  assert.equal(motionAt('zoom-in', 0).zoom, 1);
  assert.ok(motionAt('zoom-in', 1).zoom > motionAt('zoom-in', 0.5).zoom);
  assert.ok(motionAt('pan-left', 0).pan > motionAt('pan-left', 1).pan);
  assert.ok(motionAt('pan-right', 0).pan < motionAt('pan-right', 1).pan);
  assert.deepEqual(motionAt('zoom-out', -3), motionAt('zoom-out', 0), 'progress is clamped');
});

test('the picture always covers the whole frame, for every shape, motion and moment (no black edges)', () => {
  const frames = [[360, 640], [720, 720], [640, 360]];
  const pictures = [[832, 1040], [1024, 1024], [1152, 768], [300, 2000], [2000, 300]];
  for (const [fw, fh] of frames) {
    for (const [pw, ph] of pictures) {
      for (const m of MOTIONS) {
        for (let i = 0; i <= 10; i += 1) {
          const r = sceneRect(pw, ph, fw, fh, m, i / 10);
          assert.ok(r.x <= 1e-6 && r.y <= 1e-6, `${fw}x${fh} ${pw}x${ph} ${m} origin ${r.x},${r.y}`);
          assert.ok(r.x + r.w >= fw - 1e-6 && r.y + r.h >= fh - 1e-6, `${fw}x${fh} ${pw}x${ph} ${m} far edge`);
          assert.ok(Math.abs(r.w / r.h - pw / ph) < 1e-6, 'never stretched');
        }
      }
    }
  }
});

test('storyboardIssues names what blocks an export', () => {
  const ok = [scene('a'), scene('b')];
  assert.deepEqual(storyboardIssues(ok, () => true), []);
  assert.match(storyboardIssues([scene('a')], () => true).join(' '), /at least 2 scenes/);
  assert.match(storyboardIssues(ok, (id) => id === 'a').join(' '), /Scene 2 has no picture/);
  assert.match(storyboardIssues(Array.from({ length: 9 }, (_, i) => scene(`s${i}`, 2)), () => true).join(' '), /at most 8/);
  assert.match(storyboardIssues(Array.from({ length: 8 }, (_, i) => scene(`s${i}`, 8)), () => true).join(' '), /limit is 60/);
  assert.match(storyboardIssues([scene('a', 1), scene('b')], () => true).join(' '), /2 to 8 seconds/);
  assert.match(storyboardIssues([scene('a', 4, { caption: 'x'.repeat(121) }), scene('b')], () => true).join(' '), /over 120 characters/);
});

test('blank scenes alternate the camera so neighbours differ', () => {
  assert.notEqual(blankScene('a', 0).motion, blankScene('b', 1).motion);
  assert.equal(blankScene('a').seconds, STORYBOARD.defaultSeconds);
});

test('picturePrompt keeps the description and forbids writing in the picture', () => {
  const p = picturePrompt('  a red bicycle at dawn ', 'watercolor');
  assert.match(p, /^a red bicycle at dawn\. /);
  assert.match(p, /watercolour/);
  assert.match(p, /No text, no letters, no logos/);
});

const WORDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth'];
const planned = (n: number, over: Record<string, unknown> = {}) => ({
  title: 'Edit faster',
  scenes: Array.from({ length: n }, (_, i) => ({ caption: `${WORDS[i]} step of the routine`, picture: 'a tidy editing desk with two monitors', seconds: 4, motion: MOTIONS[i % 4], ...over })),
});

test('validateStoryboard accepts a good plan and fixes cosmetic problems quietly', () => {
  const r = validateStoryboard(planned(3, { seconds: 99, motion: 'spin' }), { scenes: 3, allowedNumbers: new Set([1, 2, 3]) });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.scenes.length, 3);
  assert.ok(r.value.scenes.every((s) => s.seconds === STORYBOARD.maxSeconds), 'length is clamped');
  assert.ok(r.value.scenes.every((s) => (MOTIONS as readonly string[]).includes(s.motion)), 'unknown camera moves are replaced');
});

test('validateStoryboard rejects too few scenes, bad pictures, and invented figures or promises', () => {
  const allowed = new Set<number>([1, 2, 3]);
  assert.equal(validateStoryboard(planned(2), { scenes: 3, allowedNumbers: allowed }).ok, false);
  assert.equal(validateStoryboard({ title: 'x' }, { scenes: 3, allowedNumbers: allowed }).ok, false);
  const shortPicture = validateStoryboard(planned(3, { picture: 'cat' }), { scenes: 3, allowedNumbers: allowed });
  assert.equal(shortPicture.ok, false);
  const invented = validateStoryboard(planned(3, { caption: 'Grew my channel by 300%' }), { scenes: 3, allowedNumbers: allowed });
  assert.equal(invented.ok, false);
  assert.match(invented.ok ? '' : invented.reasons.join(' '), /unsupported number 300/);
  const promise = validateStoryboard(planned(3, { caption: 'Guaranteed results for everyone' }), { scenes: 3, allowedNumbers: allowed });
  assert.equal(promise.ok, false);
});

test('validateStoryboard trims extra scenes and keeps the total under the cap', () => {
  const r = validateStoryboard(planned(8, { seconds: 8 }), { scenes: 8, allowedNumbers: new Set() });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(totalSeconds(r.value.scenes) <= STORYBOARD.maxTotalSeconds);
  assert.ok(r.value.scenes.every((s) => s.seconds >= STORYBOARD.minSeconds));
  const extra = validateStoryboard(planned(5), { scenes: 3, allowedNumbers: new Set([1, 2, 3, 4, 5]) });
  assert.equal(extra.ok && extra.value.scenes.length, 3);
});

const profile = makeProfile();

test('planStoryboard asks for the right number of scenes and returns the model\'s plan', async () => {
  const prompts: string[] = [];
  const llm: LlmCall = async ({ user }) => { prompts.push(user); const json = planned(4); return { ok: true, json, text: JSON.stringify(json) }; };
  const r = await planStoryboard(llm, profile, { topic: 'Three habits that make freelance money calmer', shape: '9:16', scenes: 4 });
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.value.scenes.length, 4);
  assert.match(prompts[0], /as 4 scenes/);
  assert.match(prompts[0], /Vertical 9:16/);
  assert.match(prompts[0], /Do not invent numbers/);
});

test('planStoryboard retries once with the rejection reasons, then succeeds', async () => {
  const prompts: string[] = [];
  let n = 0;
  const llm: LlmCall = async ({ user }) => { prompts.push(user); n += 1; const json = n === 1 ? planned(3, { caption: 'Earn $5,000 a month' }) : planned(3); return { ok: true, json, text: JSON.stringify(json) }; };
  const r = await planStoryboard(llm, profile, { topic: 'Three habits that make freelance money calmer', shape: '1:1', scenes: 3 });
  assert.equal(r.ok, true);
  assert.equal(n, 2);
  assert.match(prompts[1], /rejected for these reasons/);
});

test('planStoryboard may repeat a figure the creator gave, and nothing else', async () => {
  const llm: LlmCall = async () => { const json = planned(3, { caption: 'My 30 day plan' }); return { ok: true, json, text: JSON.stringify(json) }; };
  assert.equal((await planStoryboard(llm, profile, { topic: 'A 30 day plan for steady income', shape: '16:9', scenes: 3 })).ok, true);
  assert.equal((await planStoryboard(llm, profile, { topic: 'A plan for steady income', shape: '16:9', scenes: 3 })).ok, false);
});

test('planStoryboard says plainly when the AI is unavailable', async () => {
  const llm: LlmCall = async () => ({ ok: false, reason: 'not_configured' });
  const r = await planStoryboard(llm, profile, { topic: 'Three habits that make freelance money calmer', shape: '9:16', scenes: 3 });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, 'ai_unavailable');
  assert.match(r.ok === false ? r.message : '', /write the scenes yourself/);
});

test('scene picture allowance defaults to 30 a day and only accepts sane overrides', () => {
  const was = process.env.VIDEO_IMAGE_DAILY_LIMIT;
  try {
    delete process.env.VIDEO_IMAGE_DAILY_LIMIT;
    assert.equal(sceneImageDailyLimit(), 30);
    process.env.VIDEO_IMAGE_DAILY_LIMIT = '12';
    assert.equal(sceneImageDailyLimit(), 12);
    for (const bad of ['0', '-4', 'abc', '9999']) { process.env.VIDEO_IMAGE_DAILY_LIMIT = bad; assert.equal(sceneImageDailyLimit(), 30, bad); }
  } finally {
    if (was === undefined) delete process.env.VIDEO_IMAGE_DAILY_LIMIT; else process.env.VIDEO_IMAGE_DAILY_LIMIT = was;
  }
});

test('a 60 second export stays under the 50 MB library cap', () => assert.ok(estimatedBytes(60) < 50 * 1024 * 1024 * 0.6));

/** A recording canvas context: logs the picture draws with the alpha in force, and answers text measurements. */
function fakeCtx() {
  const draws: Array<{ alpha: number; args: number[] }> = [];
  const texts: Array<{ text: string; alpha: number }> = [];
  const state: Record<string, unknown> = { globalAlpha: 1 };
  const ctx = new Proxy(state, {
    get(target, key: string) {
      if (key === 'drawImage') return (_src: unknown, ...args: number[]) => draws.push({ alpha: target.globalAlpha as number, args });
      if (key === 'fillText') return (text: string) => texts.push({ text, alpha: target.globalAlpha as number });
      if (key === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (key in target) return target[key];
      return () => undefined;
    },
    set(target, key: string, value) { target[key] = value; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, draws, texts };
}

test('drawStoryboardFrame paints pictures and captions, cross-fading at a scene change', () => {
  const s = [scene('a', 4, { caption: 'First' }), scene('b', 4, { caption: 'Second' })];
  const pics = new Map<string, ScenePicture>([['a', { source: {} as CanvasImageSource, width: 800, height: 800 }], ['b', { source: {} as CanvasImageSource, width: 800, height: 800 }]]);

  const steady = fakeCtx();
  drawStoryboardFrame(steady.ctx, 360, 640, s, pics, 2);
  assert.equal(steady.draws.length, 1);
  assert.equal(steady.draws[0].alpha, 1);
  assert.deepEqual(steady.texts.map((t) => t.text), ['First']);

  const fading = fakeCtx();
  drawStoryboardFrame(fading.ctx, 360, 640, s, pics, 4.25);
  assert.equal(fading.draws.length, 2, 'the old and the new picture are both drawn');
  assert.equal(fading.draws[0].alpha, 1);
  assert.ok(fading.draws[1].alpha > 0 && fading.draws[1].alpha < 1);
});

test('drawStoryboardFrame draws a dark frame, not a crash, when a picture is missing, and skips empty captions', () => {
  const s = [scene('a', 4, { caption: '   ' }), scene('b', 4)];
  const f = fakeCtx();
  drawStoryboardFrame(f.ctx, 360, 640, s, new Map(), 1);
  assert.equal(f.draws.length, 0);
  assert.equal(f.texts.length, 0);
});
