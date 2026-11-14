import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRender, wrapCaption, type RenderSpec } from '../src/lib/studio/ffmpeg-args';

const spec = (over: Partial<RenderSpec> = {}): RenderSpec => ({
  aspect: '9:16', fit: 'cover', sourceHasAudio: [true, false],
  clips: [{ input: 0, start: 0, end: 3, volume: 1 }, { input: 1, start: 1, end: 4, volume: 1 }, { input: 0, start: 5, end: 6, volume: 0.5 }],
  texts: [], ...over,
});

test('the graph splits a source used twice, makes silence for a silent source, and joins the clips', () => {
  const r = buildRender(spec(), '/f.ttf', '/t');
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const g = r.args[r.args.indexOf('-filter_complex') + 1];
  assert.match(g, /\[0:v\]split=2/);
  assert.match(g, /\[0:a\]asplit=2/);
  assert.match(g, /anullsrc/);
  assert.match(g, /concat=n=3:v=1:a=1/);
  assert.equal(r.seconds, 7);
  assert.equal(`${r.width}x${r.height}`, '720x1280');
  assert.deepEqual(r.args.filter((a) => a.startsWith('__INPUT_')), ['__INPUT_0__', '__INPUT_1__']);
});

test('captions are written to files, never put into the filter text', () => {
  const r = buildRender(spec({ texts: [{ text: "It's 100%: a 'test'; [x]", start: 0, end: 2, position: 'top', size: 'medium', color: 'white', box: true }] }), '/f.ttf', '/t');
  assert.ok(!('error' in r));
  if ('error' in r) return;
  const g = r.args[r.args.indexOf('-filter_complex') + 1];
  assert.ok(!g.includes('100%'));
  assert.match(g, /textfile=\/t\/caption0\.txt/);
  assert.equal(r.textFiles[0].content, "It's 100%: a 'test'; [x]");
});

test('too long, no clips and unused sources are refused', () => {
  assert.ok('error' in buildRender(spec({ clips: [{ input: 0, start: 0, end: 130, volume: 1 }], sourceHasAudio: [true] }), '/f', '/t'));
  assert.ok('error' in buildRender(spec({ clips: [] }), '/f', '/t'));
  assert.ok('error' in buildRender(spec({ clips: [{ input: 0, start: 0, end: 3, volume: 1 }] }), '/f', '/t'));
});

test('captions wrap to the frame and the bitrate keeps the file under the library cap', () => {
  assert.ok(wrapCaption('word '.repeat(40), 47, 720).split('\n').length > 2);
  const r = buildRender(spec({ clips: [{ input: 0, start: 0, end: 118, volume: 1 }], sourceHasAudio: [true] }), '/f', '/t');
  assert.ok(!('error' in r));
  if ('error' in r) return;
  assert.ok(((r.videoBitrate + 128_000) * r.seconds) / 8 < 50 * 1024 * 1024);
});
