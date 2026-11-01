// Renders the showreel to MP4: 1920x1080, 60 fps, 15.000 s (900 frames), H.264 yuv420p, AAC audio from showreel.wav.
// Each output frame is the average of 3 sub-frames spread over a 180-degree shutter (motion blur), so fast moves look like film,
// not like a slideshow. Frames are piped straight into ffmpeg; nothing large is written to disk.
//   NODE_PATH=/opt/npm-tools/node_modules node tools/showreel/render.mjs [--frames N]    (N is only for quick tests)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'public', 'showreel');
const FPS = 60, DUR = 15, SUB = 3, SHUTTER = 0.5; // shutter as a fraction of the frame interval
const argN = process.argv.indexOf('--frames');
const FRAMES = argN > 0 ? Number(process.argv[argN + 1]) : FPS * DUR;
const WORKERS = 2;
const wav = join(root, 'showreel.wav');
const video = join(root, '_video.mp4');
const outFile = join(root, argN > 0 ? 'showreel-test.mp4' : 'showreel.mp4');

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-c:v', 'png', '-i', '-',
  '-vf', `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB,format=yuv420p`,
  '-r', String(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-level', '4.2',
  '-movflags', '+faststart', '-an', video,
], { stdio: ['pipe', 'inherit', 'inherit'] });
const ffDone = new Promise((res, rej) => { ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))); ff.on('error', rej); });

const browser = await chromium.launch();
const pages = [];
for (let w = 0; w < WORKERS; w++) {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p._errs = errs;
  await p.goto('file://' + join(root, 'showreel.html'));
  await p.evaluate(() => document.fonts.ready);
  pages.push(p);
}

const wrap = (t) => ((t % DUR) + DUR) % DUR; // the film is a loop, so a sub-frame before 0 is the end of the film
const timeOf = (f, s) => wrap(f / FPS + ((s - (SUB - 1) / 2) / SUB) * (SHUTTER / FPS));
const t0 = Date.now();
for (let f0 = 0; f0 < FRAMES; f0 += WORKERS) {
  const batch = [];
  for (let w = 0; w < WORKERS && f0 + w < FRAMES; w++) {
    batch.push((async () => {
      const bufs = [];
      for (let s = 0; s < SUB; s++) {
        await pages[w].evaluate((x) => window.seek(x), timeOf(f0 + w, s));
        bufs.push(await pages[w].screenshot({ type: 'png' }));
      }
      return bufs;
    })());
  }
  for (const bufs of await Promise.all(batch)) for (const b of bufs) if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once('drain', r));
  if (f0 % 60 === 0) console.log(`frame ${f0}/${FRAMES}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
ff.stdin.end();
await ffDone;
await browser.close();
for (const p of pages) if (p._errs.length) { console.error('PAGE ERRORS:', p._errs.join('\n')); process.exit(1); }

// mux the soundtrack (cut to the picture length)
if (!existsSync(wav)) { console.error('showreel.wav missing: run audio.mjs first'); process.exit(1); }
await new Promise((res, rej) => {
  const m = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  m.on('close', (c) => (c === 0 ? res() : rej(new Error('mux failed ' + c))));
});
console.log(`done: ${outFile} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
