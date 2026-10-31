const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const dir = path.join(__dirname, '.out');
const init = fs.readFileSync(path.join(dir, 'init-script.js'), 'utf8');
const html = `<!doctype html><html lang=en><meta charset=utf-8><title>t</title><script>${init}</script><body><div id=root></div><script src=display-bundle.js></script>`;
const server = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(html); }
  const p = path.join(dir, req.url.slice(1));
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/javascript' }); fs.createReadStream(p).pipe(res);
});
let fails = 0; const ok = (n, c, d = '') => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? '  ' + d : '')); };
(async () => {
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const attr = (page, a) => page.evaluate((x) => document.documentElement.getAttribute(x), a);

  // 1. saved choices are applied before React runs, and the panel shows them
  let ctx = await browser.newContext(); let page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('[pageerror]', e.message); });
  await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('pbos-display', JSON.stringify({ textSize: 'larger', contrast: 'high', font: 'default', motion: 'system' })); sessionStorage.setItem('seeded', '1'); } });
  const seen = []; await page.exposeFunction('record', (v) => seen.push(v));
  await page.goto(url);
  ok('saved text size applied', (await attr(page, 'data-text-size')) === 'larger');
  ok('saved contrast applied', (await attr(page, 'data-contrast')) === 'high');
  ok('unset choices leave no attribute', (await attr(page, 'data-font')) === null && (await attr(page, 'data-motion')) === null);
  const btn = page.getByRole('button', { name: 'Display settings' });
  ok('panel starts closed', (await btn.getAttribute('aria-expanded')) === 'false' && !(await page.getByRole('group', { name: 'Display settings' }).isVisible()));
  await btn.click();
  ok('panel opens', (await btn.getAttribute('aria-expanded')) === 'true' && (await page.getByRole('group', { name: 'Display settings' }).isVisible()));
  ok('radios reflect the saved state', (await page.getByLabel('Larger').isChecked()) && (await page.locator('input[name="display-contrast"][value="high"]').isChecked()));

  // 2. changing a choice applies at once and persists
  await page.getByLabel('Easy to read').check();
  ok('font attribute set', (await attr(page, 'data-font')) === 'readable');
  const stored = JSON.parse(await page.evaluate(() => localStorage.getItem('pbos-display')));
  ok('choice persisted', stored.font === 'readable' && stored.textSize === 'larger', JSON.stringify(stored));
  await page.getByLabel('Reduce motion').check();
  ok('motion attribute set', (await attr(page, 'data-motion')) === 'reduce');

  // 3. Escape closes and returns focus
  await page.keyboard.press('Escape');
  ok('Escape closes the panel', (await btn.getAttribute('aria-expanded')) === 'false');
  ok('focus returns to the button', await btn.evaluate((el) => document.activeElement === el));

  // 4. reset clears attributes and storage
  await btn.click();
  await page.getByRole('button', { name: 'Reset' }).click();
  ok('reset removes every attribute', ['data-text-size', 'data-contrast', 'data-font', 'data-motion'].every((a) => true) && (await page.evaluate(() => ['data-text-size', 'data-contrast', 'data-font', 'data-motion'].every((a) => !document.documentElement.hasAttribute(a)))));
  ok('reset clears storage', (await page.evaluate(() => localStorage.getItem('pbos-display'))) === null);
  ok('reset button disabled at defaults', await page.getByRole('button', { name: 'Reset' }).isDisabled());
  await ctx.close();

  // 5. tampered storage cannot inject anything
  ctx = await browser.newContext(); page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('[pageerror]', e.message); });
  await page.addInitScript(() => localStorage.setItem('pbos-display', JSON.stringify({ textSize: '"><script>window.pwned=1</script>', contrast: 'high' })));
  await page.goto(url);
  ok('invalid value ignored, valid one kept', (await attr(page, 'data-text-size')) === null && (await attr(page, 'data-contrast')) === 'high');
  ok('nothing was injected', (await page.evaluate(() => window.pwned)) === undefined);
  await ctx.close();

  // 6. blocked storage: no crash, panel says so
  ctx = await browser.newContext(); page = await ctx.newPage();
  page.on('pageerror', (e) => { fails++; console.log('[pageerror]', e.message); });
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } }); });
  await page.goto(url);
  await page.getByRole('button', { name: 'Display settings' }).click();
  await page.getByLabel('Large', { exact: true }).check();
  ok('still applies for this visit when storage is blocked', (await attr(page, 'data-text-size')) === 'large');
  ok('tells the user it could not save', (await page.getByText('Could not save').count()) === 1);
  await browser.close(); server.close();
  console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED'); process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('[harness error]', e.message); process.exit(2); });
