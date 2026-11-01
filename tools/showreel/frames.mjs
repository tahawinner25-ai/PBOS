// Dev helper: render chosen times to PNGs and a contact sheet so the motion can be looked at.
//   NODE_PATH=/opt/npm-tools/node_modules node tools/showreel/frames.mjs <outDir> t1 t2 t3 ...
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = dirname(fileURLToPath(import.meta.url));
const page_ = join(here, '..', '..', 'public', 'showreel', 'showreel.html');
const [outDir, ...ts] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('file://' + page_);
await page.evaluate(() => document.fonts.ready);
for (const t of ts) {
  await page.evaluate((x) => window.seek(x), Number(t));
  await page.screenshot({ path: join(outDir, `t${Number(t).toFixed(3).padStart(7, '0')}.png`) });
}
await browser.close();
if (errors.length) { console.error('PAGE ERRORS:\n' + errors.join('\n')); process.exit(1); }
console.log(`rendered ${ts.length} frames to ${outDir}`);
