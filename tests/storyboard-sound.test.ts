import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SOUND, FADE_IN, FADE_OUT, MUSIC_MOODS, cleanSound, fadeAt, hasSound, musicPlan } from '../src/lib/storyboard/audio';
import { STORYBOARD, type Scene } from '../src/lib/storyboard/plan';
import { buildDraft, hasWork, parseDraft, PICTURE_MAX_BYTES, type StoredDraft } from '../src/lib/storyboard/store';

const MOODS = MUSIC_MOODS.filter((m) => m !== 'none');

test('there is no music for "none" or for a video with no length', () => {
  assert.deepEqual(musicPlan('none', 30), []);
  assert.deepEqual(musicPlan('calm', 0), []);
  assert.deepEqual(musicPlan('calm', -4), []);
});

test('every mood writes a track that stays inside the video and stays quiet enough not to clip', () => {
  for (const mood of MOODS) {
    for (const seconds of [3, 17.5, 60]) {
      const notes = musicPlan(mood, seconds);
      assert.ok(notes.length > 0, `${mood} ${seconds}s has notes`);
      for (const n of notes) {
        assert.ok(n.start >= 0 && n.start < seconds, `${mood} start ${n.start}`);
        assert.ok(n.duration > 0 && n.start + n.duration <= seconds + 1e-9, `${mood} ends inside the video`);
        assert.ok(n.freq >= 20 && n.freq <= 4000, `${mood} freq ${n.freq}`);
        assert.ok(n.gain > 0 && n.gain <= 0.1, `${mood} gain ${n.gain}`);
      }
      // The loudest moment: add up everything sounding at each note's start. Leaves headroom below 1.
      const peak = Math.max(...notes.map((a) => notes.filter((b) => b.start <= a.start && b.start + b.duration > a.start).reduce((sum, b) => sum + b.gain, 0)));
      assert.ok(peak < 0.6, `${mood} peak ${peak}`);
    }
  }
});

test('the track is deterministic and in time order, and a longer video only adds to it', () => {
  const a = musicPlan('warm', 20);
  assert.deepEqual(a, musicPlan('warm', 20));
  assert.deepEqual([...a].sort((x, y) => x.start - y.start), a);
  const longer = musicPlan('warm', 40);
  assert.ok(longer.length > a.length);
  assert.deepEqual(longer.filter((n) => n.start + n.duration < 19), a.filter((n) => n.start + n.duration < 19));
});

test('moods are genuinely different from each other', () => {
  const sig = (m: (typeof MOODS)[number]) => JSON.stringify(musicPlan(m, 12).map((n) => [Math.round(n.freq), n.wave, Math.round(n.start * 10)]));
  assert.equal(new Set(MOODS.map(sig)).size, MOODS.length);
});

test('the mix fades in at the start and out at the end', () => {
  assert.equal(fadeAt(0, 30), 0);
  assert.ok(fadeAt(FADE_IN / 2, 30) > 0 && fadeAt(FADE_IN / 2, 30) < 1);
  assert.equal(fadeAt(15, 30), 1);
  assert.ok(fadeAt(30 - FADE_OUT / 2, 30) > 0 && fadeAt(30 - FADE_OUT / 2, 30) < 1);
  assert.equal(fadeAt(30, 30), 0);
  assert.equal(fadeAt(5, 0), 0);
  assert.ok(fadeAt(1, 2) <= 1 && fadeAt(1, 2) >= 0, 'a very short video never goes out of range');
});

test('a video carries sound only when music or the creator\'s own audio is actually on', () => {
  assert.equal(hasSound(DEFAULT_SOUND, false), false);
  assert.equal(hasSound({ ...DEFAULT_SOUND, mood: 'calm' }, false), true);
  assert.equal(hasSound({ ...DEFAULT_SOUND, mood: 'calm', musicVolume: 0 }, false), false, 'music at zero volume is silence');
  assert.equal(hasSound(DEFAULT_SOUND, true), true);
  assert.equal(hasSound({ ...DEFAULT_SOUND, ownVolume: 0 }, true), false);
});

test('cleanSound repairs anything odd that comes out of storage', () => {
  assert.deepEqual(cleanSound(null), DEFAULT_SOUND);
  assert.deepEqual(cleanSound({ mood: 'disco' as never, musicVolume: 7, ownVolume: -2 }), { mood: 'none', musicVolume: 1, ownVolume: 0 });
  assert.deepEqual(cleanSound({ mood: 'bright', musicVolume: Number.NaN as never }), { mood: 'bright', musicVolume: DEFAULT_SOUND.musicVolume, ownVolume: 1 });
});

/* ── the saved draft ── */

const scene = (id: string, over: Partial<Scene> = {}): Scene => ({ id, caption: 'A caption', picture: 'a quiet desk with a laptop', seconds: 4, motion: 'zoom-in', ...over });
const jpeg = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], { type: 'image/jpeg' });
const draft = (over: Partial<StoredDraft> = {}): StoredDraft => buildDraft({
  topic: 'Three habits for calm money', title: 'Calm money', shape: '9:16', style: 'photo', scenes: [scene('a'), scene('b')],
  sound: { mood: 'calm', musicVolume: 0.4, ownVolume: 1 }, pictures: { a: { blob: jpeg(), width: 832, height: 1040, origin: 'free' } }, ownAudio: null, ...over,
}, 1_700_000_000_000);

test('a draft survives a round trip exactly', () => {
  const d = draft();
  const back = parseDraft(d);
  assert.ok(back);
  assert.equal(back.title, 'Calm money');
  assert.equal(back.topic, 'Three habits for calm money');
  assert.deepEqual(back.scenes, d.scenes);
  assert.deepEqual(back.sound, d.sound);
  assert.equal(back.savedAt, 1_700_000_000_000);
  assert.equal(back.pictures.a.width, 832);
  assert.equal(back.pictures.a.blob.size, 7);
});

test('storage is not trusted: junk, other versions and empty drafts are refused', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { version: 99, scenes: [scene('a')] }, { version: 1, scenes: [] }, { version: 1, scenes: 'no' }, { version: 1, scenes: [{ nope: true }] }]) {
    assert.equal(parseDraft(bad), null, JSON.stringify(bad));
  }
});

test('scenes read back are cleaned: lengths, seconds, camera, duplicates and the 8 scene cap', () => {
  const raw = { ...draft(), scenes: [
    scene('a', { caption: 'x'.repeat(500), picture: 'y'.repeat(900), seconds: 99, motion: 'spin' as never }),
    scene('a'),
    scene('b', { seconds: -3 }),
    ...Array.from({ length: 12 }, (_, i) => scene(`z${i}`)),
  ] };
  const back = parseDraft(raw);
  assert.ok(back);
  assert.equal(back.scenes.length, STORYBOARD.maxScenes, 'capped');
  assert.equal(new Set(back.scenes.map((s) => s.id)).size, back.scenes.length, 'duplicate ids dropped');
  assert.equal(back.scenes[0].caption.length, STORYBOARD.captionMax);
  assert.equal(back.scenes[0].picture.length, STORYBOARD.pictureMax);
  assert.equal(back.scenes[0].seconds, STORYBOARD.maxSeconds);
  assert.equal(back.scenes[1].seconds, STORYBOARD.minSeconds);
  assert.ok(['zoom-in', 'zoom-out', 'pan-left', 'pan-right'].includes(back.scenes[0].motion));
});

test('pictures read back must belong to a scene, be real blobs of a sane size, and have a size', () => {
  const orphan = { blob: jpeg(), width: 100, height: 100, origin: 'free' };
  const raw = { ...draft(), pictures: {
    a: { blob: jpeg(), width: 832, height: 1040, origin: 'upload' },
    ghost: orphan,
    b: { blob: 'not a blob', width: 100, height: 100, origin: 'free' },
  } };
  const back = parseDraft(raw);
  assert.ok(back);
  assert.deepEqual(Object.keys(back.pictures), ['a']);
  assert.equal(back.pictures.a.origin, 'upload');
  assert.equal(Object.keys(parseDraft({ ...draft(), pictures: { a: { blob: new Blob([]), width: 10, height: 10, origin: 'free' } } })!.pictures).length, 0, 'empty file dropped');
  assert.equal(Object.keys(parseDraft({ ...draft(), pictures: { a: { blob: jpeg(), width: 0, height: 10, origin: 'free' } } })!.pictures).length, 0, 'no size dropped');
  assert.equal(Object.keys(parseDraft({ ...draft(), pictures: { a: { blob: new Blob([new Uint8Array(PICTURE_MAX_BYTES + 1)]), width: 10, height: 10, origin: 'free' } } })!.pictures).length, 0, 'oversized dropped');
});

test('the saved audio file is kept only when it is a real, non-empty blob', () => {
  const audio = new Blob([new Uint8Array(100)], { type: 'audio/mpeg' });
  assert.equal(parseDraft(draft({ ownAudio: { name: 'voice.mp3', blob: audio } }))!.ownAudio?.name, 'voice.mp3');
  assert.equal(parseDraft({ ...draft(), ownAudio: { name: 'x', blob: 'nope' } })!.ownAudio, null);
  assert.equal(parseDraft({ ...draft(), ownAudio: { name: 'x', blob: new Blob([]) } })!.ownAudio, null);
});

test('only a draft with some work in it is worth restoring', () => {
  assert.equal(hasWork({ scenes: [scene('a', { caption: '', picture: '' })], pictures: {} }), false);
  assert.equal(hasWork({ scenes: [scene('a', { caption: 'Hi', picture: '' })], pictures: {} }), true);
  assert.equal(hasWork({ scenes: [scene('a', { caption: '', picture: '' })], pictures: { a: { blob: jpeg(), width: 1, height: 1, origin: 'free' } } }), true);
});
