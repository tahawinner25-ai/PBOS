const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const dir = path.join(__dirname, '.out');
const fixtures = path.join(__dirname, '..', 'fixtures');
fs.mkdirSync(dir, { recursive: true });
const uploads = [];
const server = http.createServer((req, res) => {
  if (req.method === 'PUT' && req.url === '/upload') { let n = 0; req.on('data', (c) => (n += c.length)); req.on('end', () => { uploads.push(n); res.writeHead(200); res.end('{}'); }); return; }
  const f = req.url === '/' ? 'index.html' : req.url.slice(1);
  const p = f.endsWith('.webm') ? path.join(fixtures, f) : path.join(dir, f);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'video/webm' });
  fs.createReadStream(p).pipe(res);
});
fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>t</title><body><div id=root></div><script src=bundle.js></script>');
let fails = 0;
const ok = (name, pass, detail = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); };

(async () => {
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const simulateH264 = process.argv.includes('--h264');
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on('pageerror', (e) => { fails++; console.log('[pageerror]', e.message); });
  page.on('console', (m) => { const x = m.text(); if (m.type() === 'error' && !x.startsWith('Canvas2D')) console.log('[console.error]', x.slice(0, 300)); });
  if (simulateH264) {
    // Pretends this browser can record H.264, only to exercise the "save to library" screen. The data is still whatever Chromium records.
    await page.addInitScript(() => {
      const real = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      const Orig = window.MediaRecorder;
      MediaRecorder.isTypeSupported = (m) => (m.includes('avc1') ? true : real(m));
      window.MediaRecorder = class extends Orig { constructor(s, o = {}) { super(s, { ...o, mimeType: o.mimeType && o.mimeType.includes('avc1') ? 'video/mp4' : o.mimeType }); } };
      window.MediaRecorder.isTypeSupported = MediaRecorder.isTypeSupported;
    });
  }
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('canvas');

  const canvas = page.locator('canvas');
  ok('empty state label', (await canvas.getAttribute('aria-label')).includes('empty'));
  ok('play disabled when empty', await page.getByRole('button', { name: 'Play preview' }).isDisabled());

  // add from library
  await page.getByRole('button', { name: /Add Library clip to the timeline/ }).click();
  await page.waitForSelector('ol[aria-label="Clips in order"] li');
  ok('library clip added', (await page.locator('ol[aria-label="Clips in order"] li').count()) === 1);
  ok('library link requested', (await page.evaluate(() => window.__calls)).some((c) => c.fn === 'signedVideoUrl'));
  ok('canvas label describes the clip', (await canvas.getAttribute('aria-label')).includes('Clip 1 of 1'), await canvas.getAttribute('aria-label'));

  // add from device
  await page.setInputFiles('#studio-local-file', path.join(fixtures, 'b.webm'));
  await page.waitForFunction(() => document.querySelectorAll('ol[aria-label="Clips in order"] li').length === 2);
  ok('device file added', true);

  // select clip 1 and trim end to 2s through the number field
  await page.getByRole('button', { name: /Clip 1/ }).first().click();
  await page.waitForSelector('text=Clip 1 of 2');
  const endField = page.getByLabel('End (seconds)');
  await endField.fill('2');
  await endField.blur();
  await page.waitForFunction(() => /0:02\.0/.test(document.querySelector('ol[aria-label="Clips in order"] li').textContent));
  ok('trim by typing updates the timeline', true);

  // volume mute
  await page.getByLabel('Mute this clip').check();
  ok('mute sets volume 0', (await page.getByText('Volume: 0%').count()) === 1);

  // move later
  await page.getByRole('button', { name: /Move later/ }).click();
  ok('moving later reorders (inspector now says clip 2 of 2)', (await page.getByText('Clip 2 of 2').count()) === 1);

  // seek to 1s and add text
  await page.locator('#studio-seek').fill('1');
  await page.getByRole('button', { name: /Add text/ }).click();
  await page.waitForSelector('#text-' + '>> nth=0').catch(() => {});
  const textInput = page.getByLabel('What it says');
  await textInput.fill('HELLO STUDIO');
  ok('text overlay listed', (await page.locator('ul[aria-label="Text overlays"] li').count()) === 1);
  ok('canvas label mentions the text', (await canvas.getAttribute('aria-label')).includes('HELLO STUDIO'), await canvas.getAttribute('aria-label'));

  // split
  await page.locator('#studio-seek').fill('1.5');
  const before = await page.locator('ol[aria-label="Clips in order"] li').count();
  await page.getByRole('button', { name: /Split at playhead/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll('ol[aria-label="Clips in order"] li').length === n + 1, before);
  ok('split adds a clip', true);

  // undo / redo
  await page.getByRole('button', { name: 'Undo' }).click();
  ok('undo removes the split', (await page.locator('ol[aria-label="Clips in order"] li').count()) === before);
  await page.getByRole('button', { name: 'Redo' }).click();
  ok('redo restores the split', (await page.locator('ol[aria-label="Clips in order"] li').count()) === before + 1);

  // aspect radio
  await page.getByLabel(/Square 1:1/).check();
  const dims = await canvas.evaluate((c) => [c.width, c.height]);
  ok('square shape changes the canvas', dims[0] === dims[1], JSON.stringify(dims));

  // error path: removing everything then splitting is disabled; invalid trim shows an alert
  await page.getByRole('button', { name: /Clip 1/ }).first().click();
  const startField = page.getByLabel('Start (seconds)');
  const endF = page.getByLabel('End (seconds)');
  await endF.fill('0.1'); await endF.blur();
  await page.waitForSelector('[role=alert]');
  ok('trim shorter than the minimum shows an alert', (await page.locator('[role=alert]').first().textContent()).length > 5, await page.locator('[role=alert]').first().textContent());

  // accessibility sanity: every control has a name, ids unique
  const unnamed = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea, button, canvas[role=img]')) {
      if (el.type === 'hidden' || el.closest('[hidden]')) continue;
      const name = (el.getAttribute('aria-label') || '').trim() || (el.labels && [...el.labels].map((l) => l.textContent).join('').trim()) || el.textContent.trim() ||
        (el.getAttribute('aria-labelledby') && document.getElementById(el.getAttribute('aria-labelledby'))?.textContent.trim());
      if (!name) out.push(el.outerHTML.slice(0, 120));
    }
    return out;
  });
  ok('every control has an accessible name', unnamed.length === 0, unnamed.join(' | '));
  const dupes = await page.evaluate(() => { const seen = new Set(), d = []; for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) d.push(el.id); seen.add(el.id); } return d; });
  ok('ids are unique', dupes.length === 0, dupes.join(','));

  // restore a sane project for export: select clip 1 and fix its end
  await endF.fill('1.5'); await endF.blur();
  ok('export button enabled', await page.getByRole('button', { name: /Export video/ }).isEnabled());
  const notice = await page.locator('#studio-export-h').locator('xpath=..').textContent();
  console.log('   export panel text:', notice.replace(/\s+/g, ' ').slice(0, 400));

  await page.getByRole('button', { name: /Export video/ }).click();
  ok('timeline locked while exporting', await page.locator('fieldset[disabled]').count() > 0);
  await page.waitForSelector('video[aria-label="Preview of the exported video"]', { timeout: 60000 });
  ok('export finished with a preview', true);
  const dl = await page.locator('a[download]').getAttribute('download');
  ok('download link has a name', /^pbos-edit-\d{4}-\d{2}-\d{2}\.(mp4|webm)$/.test(dl), dl);
  const canSave = await page.getByRole('button', { name: /Save to my library/ }).count();
  ok(simulateH264 ? 'save to library offered when H.264 is available' : 'save to library NOT offered when H.264 is not confirmed', simulateH264 ? canSave === 1 : canSave === 0);
  if (simulateH264 && canSave) {
    await page.getByRole('button', { name: /Save to my library/ }).click();
    await page.waitForSelector('text=Saved. It is in your library');
    const calls = await page.evaluate(() => window.__calls);
    const req = calls.find((c) => c.fn === 'requestMediaUpload'), reg = calls.find((c) => c.fn === 'registerMedia');
    ok('upload requested as video/mp4 with the real size', req && req.mime === 'video/mp4' && req.bytes > 1000 && uploads[0] >= req.bytes && uploads[0] - req.bytes < 1000, JSON.stringify(req) + ' uploaded=' + uploads[0]);
    ok('registered with size and length', reg && reg.width > 0 && reg.height > 0 && reg.duration > 0, JSON.stringify(reg));
  }
  await page.screenshot({ path: path.join(dir, simulateH264 ? 'shot-h264.png' : 'shot.png'), fullPage: true });
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('[harness error]', e.message); process.exit(2); });
