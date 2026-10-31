import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LIMITS, activeOverlays, addClip, addOverlay, clipOffsets, describeFrame, emptyProject, exportPlan, fitRect, formatTime, locate, moveClip, outputSize, removeClip, removeOverlay, setClipVolume,
  splitAt, timelineLength, trimClip, updateOverlay, validateProject, type Edit, type Project,
} from '../src/lib/studio/edl';

const must = (e: Edit): Project => { assert.ok(e.ok, e.ok ? '' : e.error); return e.ok ? e.project : (undefined as never); };
const two = (): Project => {
  let p = emptyProject();
  p = must(addClip(p, { sourceId: 'a', label: 'Intro', duration: 10 }, 'c1'));
  p = must(addClip(p, { sourceId: 'b', label: 'Main', duration: 20 }, 'c2'));
  return p;
};

test('clips lay end to end and the timeline is their total', () => {
  const p = two();
  assert.equal(timelineLength(p), 30);
  assert.deepEqual(clipOffsets(p), [0, 10]);
  assert.equal(locate(p, 4)?.clip.id, 'c1');
  assert.equal(locate(p, 10)?.clip.id, 'c2');
  assert.equal(locate(p, 12.5)?.sourceTime, 2.5);
  assert.equal(locate(p, 999)?.clip.id, 'c2', 'past the end shows the last frame');
  assert.equal(locate(emptyProject(), 0), null);
});

test('trimming moves the in and out points, never leaves the source, and keeps a minimum length', () => {
  let p = two();
  p = must(trimClip(p, 'c2', 5, 15));
  assert.equal(timelineLength(p), 20);
  assert.equal(locate(p, 10)?.sourceTime, 5, 'the second clip now starts at its in point');
  p = must(trimClip(p, 'c2', -3, 999));
  assert.deepEqual([p.clips[1].start, p.clips[1].end], [0, 20]);
  assert.equal(trimClip(p, 'c2', 5, 5.1).ok, false);
  assert.equal(trimClip(p, 'nope', 0, 5).ok, false);
  assert.equal(trimClip(p, 'c2', Number.NaN, 5).ok, false);
});

test('split makes two clips that play exactly as the original, and refuses to cut at the very edge', () => {
  const p = two();
  const e = splitAt(p, 4, 'c3');
  const s = must(e);
  assert.equal(s.clips.length, 3);
  assert.deepEqual(s.clips.slice(0, 2).map((c) => [c.start, c.end]), [[0, 4], [4, 10]]);
  assert.equal(timelineLength(s), timelineLength(p));
  assert.equal(e.ok && e.selectId, 'c3');
  assert.equal(locate(s, 7)?.sourceTime, locate(p, 7)?.sourceTime);
  assert.equal(splitAt(p, 0.1, 'x').ok, false);
  assert.equal(splitAt(p, 9.9, 'x').ok, false);
  assert.equal(splitAt(emptyProject(), 1, 'x').ok, false);
});

test('reorder and delete', () => {
  let p = two();
  p = must(moveClip(p, 'c1', 1));
  assert.deepEqual(p.clips.map((c) => c.id), ['c2', 'c1']);
  assert.equal(moveClip(p, 'c2', -1).ok, false);
  assert.equal(moveClip(p, 'c1', 1).ok, false);
  p = must(removeClip(p, 'c2'));
  assert.deepEqual(p.clips.map((c) => c.id), ['c1']);
  assert.equal(removeClip(p, 'c2').ok, false);
});

test('limits: clip count, tiny clips and unreadable durations are refused', () => {
  let p = emptyProject();
  for (let i = 0; i < LIMITS.maxClips; i++) p = must(addClip(p, { sourceId: 's', label: 'x', duration: 2 }, `k${i}`));
  assert.equal(addClip(p, { sourceId: 's', label: 'x', duration: 2 }, 'over').ok, false);
  assert.equal(splitAt(p, 1, 'z').ok, false);
  assert.equal(addClip(emptyProject(), { sourceId: 's', label: 'x', duration: Number.NaN }, 'n').ok, false);
  assert.equal(addClip(emptyProject(), { sourceId: 's', label: 'x', duration: 0.1 }, 'n').ok, false);
});

test('volume is clamped to 0..1', () => {
  let p = two();
  p = must(setClipVolume(p, 'c1', 3));
  assert.equal(p.clips[0].volume, 1);
  p = must(setClipVolume(p, 'c1', -1));
  assert.equal(p.clips[0].volume, 0);
  assert.equal(setClipVolume(p, 'c1', Number.NaN).ok, false);
});

test('text: added at the playhead, validated, and kept inside the timeline when clips shrink', () => {
  let p = two();
  p = must(addOverlay(p, 28, 'o1', 'Hello'));
  assert.deepEqual([p.overlays[0].start, p.overlays[0].end], [28, 30]);
  assert.equal(updateOverlay(p, 'o1', { text: 'x'.repeat(LIMITS.overlayText + 1) }).ok, false);
  assert.equal(updateOverlay(p, 'o1', { position: 'sideways' as never }).ok, false);
  assert.equal(updateOverlay(p, 'o1', { start: 5, end: 5.05 }).ok, false);
  p = must(updateOverlay(p, 'o1', { start: 1, end: 29, color: 'yellow' }));
  assert.equal(p.overlays[0].color, 'yellow');
  assert.deepEqual(activeOverlays(p, 0.5), []);
  assert.equal(activeOverlays(p, 2).length, 1);
  // Cut the video down: the text is pulled back, and removed if nothing is left of it.
  p = must(trimClip(p, 'c2', 0, 5));
  assert.ok(p.overlays[0].end <= timelineLength(p));
  p = must(trimClip(p, 'c1', 0, 0.5));
  p = must(removeClip(p, 'c2'));
  assert.ok(p.overlays.length === 1 && p.overlays[0].end <= 0.5 + 1e-9 && p.overlays[0].start >= 0, 'what is left of the text stays inside the 0.5 s timeline');
  p = must(removeClip(p, 'c1'));
  assert.equal(p.overlays.length, 0, 'no video left, so no text');
  assert.equal(addOverlay(emptyProject(), 0, 'o', 'x').ok, false);
  assert.equal(removeOverlay(two(), 'zzz').ok, false);
});

test('at most LIMITS.maxOverlays text layers', () => {
  let p = two();
  for (let i = 0; i < LIMITS.maxOverlays; i++) p = must(addOverlay(p, i, `o${i}`));
  assert.equal(addOverlay(p, 1, 'extra').ok, false);
});

test('output sizes are even and match the aspect', () => {
  assert.deepEqual(outputSize('9:16', '1080p'), { width: 1080, height: 1920 });
  assert.deepEqual(outputSize('16:9', '720p'), { width: 1280, height: 720 });
  assert.deepEqual(outputSize('1:1', '1080p'), { width: 1080, height: 1080 });
  for (const a of ['9:16', '1:1', '16:9'] as const) for (const q of ['720p', '1080p'] as const) {
    const s = outputSize(a, q);
    assert.equal(s.width % 2, 0);
    assert.equal(s.height % 2, 0);
  }
});

test('fitRect: cover fills the frame, contain keeps the whole picture', () => {
  const cover = fitRect(1920, 1080, 1080, 1920, 'cover');
  assert.ok(cover.h >= 1920 - 1e-6 && cover.w >= 1080);
  assert.ok(cover.x < 0, 'a wide picture is cropped at the sides');
  const contain = fitRect(1920, 1080, 1080, 1920, 'contain');
  assert.equal(Math.round(contain.w), 1080);
  assert.ok(contain.h < 1920 && contain.y > 0, 'bars above and below');
  assert.deepEqual(fitRect(0, 0, 100, 50, 'cover'), { x: 0, y: 0, w: 100, h: 50 });
});

test('validateProject finds what would break an export', () => {
  assert.deepEqual(validateProject(emptyProject()), ['Add at least one clip.']);
  assert.deepEqual(validateProject(two()), []);
  const blank = must(addOverlay(two(), 1, 'o1', '   '));
  assert.ok(validateProject(blank).some((m) => /empty/.test(m)));
  let long = emptyProject();
  for (let i = 0; i < 4; i++) long = must(addClip(long, { sourceId: 's', label: 'x', duration: 100 }, `l${i}`));
  assert.ok(validateProject(long).some((m) => /limited/.test(m)));
});

test('exportPlan lowers the bitrate to fit the library cap, and says when it cannot fit', () => {
  const short = exportPlan(two(), '1080p');
  assert.equal(short.videoBitsPerSecond, 8_000_000);
  assert.ok(short.fitsLibrary === (short.estimatedBytes <= LIMITS.libraryBytes));
  let mid = emptyProject();
  mid = must(addClip(mid, { sourceId: 's', label: 'x', duration: 120 }, 'm'));
  const m = exportPlan(mid, '1080p');
  assert.ok(m.videoBitsPerSecond < 8_000_000);
  assert.ok(m.estimatedBytes <= LIMITS.libraryBytes);
  assert.equal(m.fitsLibrary, true);
  let big = emptyProject();
  big = must(addClip(big, { sourceId: 's', label: 'x', duration: 250 }, 'b'));
  assert.equal(exportPlan(big, '720p').fitsLibrary, false, 'longer than the library limit: download only');
});

test('formatTime and describeFrame', () => {
  assert.equal(formatTime(0), '0:00.0');
  assert.equal(formatTime(75.34), '1:15.3');
  const p = must(addOverlay(two(), 1, 'o1', 'Hi'));
  assert.match(describeFrame(p, 2), /Clip 1 of 2: Intro\. Text on screen: “Hi”\./);
  assert.match(describeFrame(emptyProject(), 0), /empty/);
});
