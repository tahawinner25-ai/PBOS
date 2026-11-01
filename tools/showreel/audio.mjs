// Synthesises the soundtrack (no samples, no third-party music): 136 BPM, kick on every beat, hats from bar 2,
// a plucked chord on each scene change, a riser into the final bar, ticks as the command is typed, one stab on the CTA.
// Rendered offline with the Web Audio API inside Chromium, so it is exactly 15.000 s and sample-accurate to the picture.
//   NODE_PATH=/opt/npm-tools/node_modules node tools/showreel/audio.mjs   ->   public/showreel/showreel.wav
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', 'public', 'showreel');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + join(root, 'showreel.html'));

const b64 = await page.evaluate(async () => {
  const R = window.PBOS_SHOWREEL, SR = 44100, DUR = R.DUR, BEAT = R.BEAT, T = R.T;
  const ctx = new OfflineAudioContext(2, Math.round(SR * DUR), SR);
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.14;
  master.connect(comp); comp.connect(ctx.destination);

  let seed = 20261031; const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const nbuf = ctx.createBuffer(1, SR * 2, SR); { const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; }

  const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
  const pan = (node, p) => { const s = ctx.createStereoPanner(); s.pan.value = p; node.connect(s); s.connect(master); };

  const kick = (t, g) => {
    const o = ctx.createOscillator(), a = ctx.createGain(); o.type = 'sine';
    o.frequency.setValueAtTime(175, t); o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    env(a, t, 0.003, g, 0.3); o.connect(a); a.connect(master); o.start(t); o.stop(t + 0.36);
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); n.buffer = nbuf; hp.type = 'highpass'; hp.frequency.value = 2500;
    env(ng, t, 0.001, g * 0.16, 0.012); n.connect(hp); hp.connect(ng); ng.connect(master); n.start(t, 0.1); n.stop(t + 0.03);
  };
  const hat = (t, g, p) => {
    const n = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), ng = ctx.createGain(); n.buffer = nbuf; hp.type = 'highpass'; hp.frequency.value = 7200;
    env(ng, t, 0.001, g, 0.035); n.connect(hp); hp.connect(ng); pan(ng, p); n.start(t, 0.3); n.stop(t + 0.06);
  };
  const pluck = (t, f, g, dec, p) => {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), a = ctx.createGain(), lp = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'sine'; o.frequency.value = f; o2.frequency.value = f * 2.005;
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(5200, t); lp.frequency.exponentialRampToValueAtTime(700, t + dec);
    env(a, t, 0.004, g, dec); o.connect(lp); o2.connect(lp); lp.connect(a); pan(a, p);
    o.start(t); o2.start(t); o.stop(t + dec + 0.05); o2.stop(t + dec + 0.05);
  };
  const sweep = (t0, t1, f0, f1, g, q) => {
    const n = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), a = ctx.createGain(); n.buffer = nbuf; n.loop = true; bp.type = 'bandpass'; bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t1);
    a.gain.setValueAtTime(0.0001, t0); a.gain.exponentialRampToValueAtTime(g, t1 - 0.02); a.gain.linearRampToValueAtTime(0, t1);
    n.connect(bp); bp.connect(a); a.connect(master); n.start(t0); n.stop(t1 + 0.01);
  };

  // pulse: one kick per beat; the first bar is quieter so the picture leads
  const beats = Math.round(DUR / BEAT);
  for (let n = 0; n < beats; n++) {
    const t = n * BEAT;
    if (t > DUR - 0.3) continue;
    kick(t, n < 4 ? 0.55 : 0.82);
    if (n >= 8 && t < T[7] - 0.05) { hat(t + BEAT / 2, 0.07, n % 2 ? -0.25 : 0.25); }
  }
  // scene changes: a plucked fifth on each bar line (A minor pentatonic walk)
  const roots = [220, 246.94, 261.63, 293.66, 329.63, 392, 440];
  for (let k = 1; k <= 7; k++) { const f = roots[k - 1]; pluck(T[k] + 0.02, f * 2, 0.16, 0.42, -0.2); pluck(T[k] + 0.02, f * 3, 0.1, 0.36, 0.2); }
  // riser across the last two beats of the income bar, cut at the bar line
  sweep(T[7] - 2 * BEAT, T[7], 350, 7000, 0.26, 1.4);
  { const o = ctx.createOscillator(), a = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(220, T[7] - 2 * BEAT); o.frequency.exponentialRampToValueAtTime(1760, T[7]);
    a.gain.setValueAtTime(0.0001, T[7] - 2 * BEAT); a.gain.exponentialRampToValueAtTime(0.07, T[7] - 0.03); a.gain.linearRampToValueAtTime(0, T[7]); o.connect(a); a.connect(master); o.start(T[7] - 2 * BEAT); o.stop(T[7]); }
  // the command is typed: one tick per word, a brighter one on "Send"
  for (let c = 0; c < 4; c++) { const t = T[7] + 0.35 + c * BEAT / 2 + 0.02; pluck(t, c === 3 ? 1760 : 1174.66, c === 3 ? 0.2 : 0.12, c === 3 ? 0.22 : 0.09, 0); }
  // CTA: A major stab; fold back: short downward sweep and a low thud that lands right before the loop point
  [220, 329.63, 440, 554.37].forEach((f, i) => pluck(R.T_CTA + 0.03, f, 0.13, 0.7, (i - 1.5) * 0.25));
  sweep(R.T_BACK, R.T_BACK + 0.38, 5000, 300, 0.12, 1.0);
  { const t = R.T_BACK + 0.3, o = ctx.createOscillator(), a = ctx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.25);
    env(a, t, 0.004, 0.4, 0.4); o.connect(a); a.connect(master); o.start(t); o.stop(t + 0.5); }

  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
  let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(Rr[i]));
  const gain = 0.891 / peak; // -1 dBFS
  const fadeIn = Math.round(SR * 0.002), fadeOut = Math.round(SR * 0.04);
  const out = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) {
    let f = gain; if (i < fadeIn) f *= i / fadeIn; if (i > L.length - fadeOut) f *= (L.length - i) / fadeOut;
    out[2 * i] = Math.max(-32768, Math.min(32767, Math.round(L[i] * f * 32767)));
    out[2 * i + 1] = Math.max(-32768, Math.min(32767, Math.round(Rr[i] * f * 32767)));
  }
  const bytes = new Uint8Array(out.buffer); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
});
await browser.close();

const pcm = Buffer.from(b64, 'base64');
const h = Buffer.alloc(44);
h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
writeFileSync(join(root, 'showreel.wav'), Buffer.concat([h, pcm]));
console.log(`showreel.wav written: ${(pcm.length / 44100 / 4).toFixed(3)} s, ${((pcm.length + 44) / 1024 / 1024).toFixed(2)} MB`);
