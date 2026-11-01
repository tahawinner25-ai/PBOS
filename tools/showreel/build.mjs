// Assembles the showreel into ONE self-contained HTML file (font, css and js inlined, no network).
//   node tools/showreel/build.mjs   ->   public/showreel/showreel.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, 'src', f), 'utf8');
const out = join(here, '..', '..', 'public', 'showreel', 'showreel.html');

const html = read('template.html')
  .replace('{{FONT}}', () => read('font.css'))
  .replace('{{CSS}}', () => read('style.css'))
  .replace('{{JS}}', () => read('scene.js'));

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`showreel.html written (${(html.length / 1024).toFixed(0)} KB) -> ${out}`);
