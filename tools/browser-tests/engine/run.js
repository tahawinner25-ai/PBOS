const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const dir = path.join(__dirname, '.out');
const fixtures = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const server = http.createServer((req, res) => {
  const f = req.url === '/' ? 'index.html' : req.url.slice(1);
  const p = f.endsWith('.webm') ? path.join(fixtures, f) : path.join(dir, f);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  const type = f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'video/webm';
  res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' });
  fs.createReadStream(p).pipe(res);
});
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><meta charset=utf-8><body><canvas id=c></canvas><script src=bundle.js></script>');

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('console', (m) => { const x = m.text(); if (!x.startsWith('Canvas2D')) console.log(x); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`http://127.0.0.1:${port}/`);

  const result = await page.evaluate(async () => {
    const { edl, engine } = window.Studio;
    const out = { steps: [] };
    const ok = (name, pass, detail) => { out.steps.push({ name, pass: !!pass, detail }); console.log((pass ? 'PASS ' : 'FAIL ') + name + '  ' + (detail ?? '')); };

    const blobUrl = async (name) => URL.createObjectURL(await (await fetch(name)).blob());
    const urls = { A: await blobUrl('a.webm'), B: await blobUrl('b.webm') };
    const infoA = await engine.probeVideo(urls.A);
    const infoB = await engine.probeVideo(urls.B);
    ok('probe reads length and size', Math.abs(infoA.duration - 3) < 0.2 && infoA.width === 320 && infoB.height === 180, JSON.stringify(infoA));

    let p = edl.emptyProject();
    const must = (e) => { if (!e.ok) throw new Error(e.error); return e.project; };
    p = must(edl.addClip(p, { sourceId: 'A', label: 'red', duration: infoA.duration }, 'ca'));
    p = must(edl.addClip(p, { sourceId: 'B', label: 'blue', duration: infoB.duration }, 'cb'));
    p = must(edl.trimClip(p, 'ca', 0.5, 2.5));
    p = must(edl.trimClip(p, 'cb', 0, 2));
    p = must(edl.addOverlay(p, 0, 'o1', 'HELLO WORLD'));
    p = must(edl.updateOverlay(p, 'o1', { end: 4, position: 'middle', size: 'large', box: false }));
    p = edl.setAspect(p, '9:16');
    out.total = edl.timelineLength(p);

    const canvas = document.getElementById('c');
    const eng = new engine.StudioEngine(canvas);
    eng.onError = (m) => console.log('engine error', m);
    eng.setProject(p, urls);

    const sample = (cv, fx, fy) => { const c = cv.getContext('2d'); const d = c.getImageData(Math.floor(cv.width * fx), Math.floor(cv.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; };
    const whiteCount = (cv) => { const c = cv.getContext('2d'); const w = cv.width, h = cv.height; const d = c.getImageData(0, Math.floor(h * 0.4), w, Math.floor(h * 0.2)).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) n++; return n; };

    await eng.seek(1);
    const atRed = sample(canvas, 0.05, 0.05);
    ok('seek into first clip shows red', atRed[0] > 200 && atRed[2] < 60, JSON.stringify(atRed));
    ok('text is drawn over the picture', whiteCount(canvas) > 40, String(whiteCount(canvas)));
    await eng.seek(3);
    const atBlue = sample(canvas, 0.05, 0.05);
    ok('seek into second clip shows blue', atBlue[2] > 200 && atBlue[0] < 60, JSON.stringify(atBlue));
    await eng.seek(4.5);
    ok('seek past the end clamps to the end', Math.abs(eng.time - 4) < 1e-6, String(eng.time));

    // preview playback crosses the cut and ends
    const times = [];
    eng.onTime = (t) => times.push(t);
    const ended = new Promise((r) => { eng.onEnded = r; });
    await eng.seek(0);
    await eng.play();
    await Promise.race([ended, new Promise((r) => setTimeout(r, 8000))]);
    ok('preview plays to the end', Math.abs(eng.time - 4) < 0.05 && times.length > 20, `t=${eng.time} ticks=${times.length}`);

    // export
    const fmt = engine.pickExportFormat();
    ok('this browser can record a format', !!fmt, JSON.stringify(fmt));
    const plan = { ...edl.exportPlan(p, '720p'), width: 360, height: 640, videoBitsPerSecond: 1_500_000 };
    const progress = [];
    const started = performance.now();
    const res = await eng.exportVideo(plan, fmt, { onProgress: (f) => progress.push(f), signal: new AbortController().signal });
    const took = (performance.now() - started) / 1000;
    ok('export produced a file', res.blob.size > 5000 && res.extension === fmt.extension, `${res.blob.size} bytes ${res.blob.type}`);
    ok('export ran about as long as the edit', took > 3.5 && took < 9, `${took.toFixed(1)}s`);
    ok('progress reaches the end', progress.length > 5 && progress[progress.length - 1] > 0.95, `n=${progress.length} last=${progress[progress.length - 1]}`);

    // decode what was recorded
    const v = document.createElement('video');
    v.muted = true; v.src = URL.createObjectURL(res.blob);
    await new Promise((r, j) => { v.onloadedmetadata = r; v.onerror = () => j(new Error('cannot decode export')); });
    if (!Number.isFinite(v.duration)) { v.currentTime = 1e9; await new Promise((r) => { v.ontimeupdate = () => { if (Number.isFinite(v.duration)) r(); }; setTimeout(r, 3000); }); }
    ok('export duration is about 4 s', Math.abs(v.duration - 4) < 0.7, `duration=${v.duration}`);
    ok('export is portrait at the planned size', v.videoWidth === 360 && v.videoHeight === 640, `${v.videoWidth}x${v.videoHeight}`);
    const tmp = document.createElement('canvas'); tmp.width = 360; tmp.height = 640;
    const grab = async (t) => { v.currentTime = t; await new Promise((r) => { v.onseeked = r; setTimeout(r, 2000); }); tmp.getContext('2d').drawImage(v, 0, 0); return tmp; };
    const f1 = await grab(1.0);
    const c1 = sample(f1, 0.05, 0.05);
    ok('exported frame at 1 s is red', c1[0] > 170 && c1[2] < 90, JSON.stringify(c1));
    ok('exported frame at 1 s has text', whiteCount(f1) > 40, String(whiteCount(f1)));
    const f2 = await grab(3.0);
    const c2 = sample(f2, 0.05, 0.05);
    ok('exported frame at 3 s is blue', c2[2] > 170 && c2[0] < 90, JSON.stringify(c2));

    // audio: first half should be ~440 Hz, second half ~880 Hz
    const ab = await res.blob.arrayBuffer();
    const ac = new AudioContext();
    let audioOk = false, f_a = 0, f_b = 0;
    try {
      const buf = await ac.decodeAudioData(ab.slice(0));
      const ch = buf.getChannelData(0); const sr = buf.sampleRate;
      const freq = (from, to) => { let z = 0; let prev = ch[Math.floor(from * sr)]; const n0 = Math.floor(from * sr), n1 = Math.floor(to * sr); for (let i = n0 + 1; i < n1; i++) { if ((prev < 0) !== (ch[i] < 0)) z++; prev = ch[i]; } return z / 2 / (to - from); };
      f_a = freq(0.4, 1.6); f_b = freq(2.4, 3.6);
      audioOk = Math.abs(f_a - 440) < 60 && Math.abs(f_b - 880) < 90;
    } catch (e) { out.audioError = String(e); }
    ok('exported audio carries each clip’s tone in order', audioOk, `first≈${Math.round(f_a)}Hz second≈${Math.round(f_b)}Hz ${out.audioError ?? ''}`);

    // a muted clip stays silent
    p = must(edl.setClipVolume(p, 'cb', 0));
    eng.setProject(p, urls);
    const res2 = await eng.exportVideo(plan, fmt, { onProgress() {}, signal: new AbortController().signal });
    const b64 = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(b); });
    out.files = { r1: await b64(res.blob), r2: await b64(res2.blob) };
    try {
      const ab2 = await res2.blob.arrayBuffer();
      const buf2 = await new AudioContext().decodeAudioData(ab2.slice(0));
      const ch2 = buf2.getChannelData(0); const sr2 = buf2.sampleRate;
      const rms = (from, to) => { let s = 0; const n0 = Math.floor(from * sr2), n1 = Math.floor(to * sr2); for (let i = n0; i < n1; i++) s += ch2[i] * ch2[i]; return Math.sqrt(s / (n1 - n0)); };
      const r1 = rms(0.4, 1.6), r2 = rms(2.4, 3.6);
      ok('volume 0 silences that clip only', r1 > 0.02 && r2 < 0.005, `first rms=${r1.toFixed(3)} second rms=${r2.toFixed(4)} size=${res2.blob.size}`);
    } catch (e) { ok('volume 0 silences that clip only', false, 'decode failed: ' + e + ' size=' + res2.blob.size); }

    // cancel
    const ac2 = new AbortController();
    setTimeout(() => ac2.abort(), 800);
    let cancelled = false;
    try { await eng.exportVideo(plan, fmt, { onProgress() {}, signal: ac2.signal }); } catch (e) { cancelled = e.message === 'cancelled'; }
    ok('an export can be cancelled', cancelled, '');
    ok('the engine is usable after a cancel', !eng.isPlaying, '');

    return out;
  });

  const fsx = require('fs'); if (result.files) { fsx.writeFileSync(path.join(dir, 'export1.mp4'), Buffer.from(result.files.r1, 'base64')); fsx.writeFileSync(path.join(dir, 'export2.mp4'), Buffer.from(result.files.r2, 'base64')); }
  let failed = 0;
  for (const s of result.steps) { if (!s.pass) failed++; }
  console.log(failed === 0 ? `ALL ${result.steps.length} PASS` : `${failed} FAILED`);
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
