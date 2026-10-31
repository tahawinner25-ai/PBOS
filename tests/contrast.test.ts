import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

/**
 * Reads the design tokens straight out of globals.css and checks WCAG contrast for the pairs the interface really
 * uses. If someone edits a colour and it drops below the minimum, this fails. Ratios use the WCAG 2.x formula.
 */
const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8');

type Hsl = [number, number, number];
type Tokens = Record<string, Hsl>;

function tokensIn(selector: string): Tokens {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `selector ${selector} not found in globals.css`);
  const end = css.indexOf('\n  }', start);
  const body = css.slice(start, end);
  const out: Tokens = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*;/g)) out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  return out;
}

function rgb([h, s, l]: Hsl): [number, number, number] {
  const sat = s / 100, light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
const luminance = (c: Hsl) => {
  const [r, g, b] = rgb(c).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Hsl, b: Hsl) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };

// Text pairs need 4.5:1. Non-text parts of controls (field borders, focus rings) need 3:1.
const TEXT: Array<[string, string]> = [
  ['foreground', 'background'], ['card-foreground', 'card'], ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'], ['muted-foreground', 'card'], ['muted-foreground', 'muted'], ['muted-foreground', 'accent'],
  ['primary-foreground', 'primary'], ['secondary-foreground', 'secondary'], ['accent-foreground', 'accent'],
  ['destructive', 'background'], ['destructive', 'card'], ['success', 'background'], ['warning', 'background'], ['primary', 'background'],
  ['destructive-foreground', 'destructive'], ['success-foreground', 'success'], ['warning-foreground', 'warning'],
  ['paper-foreground', 'paper'],
];
const UI: Array<[string, string]> = [['input', 'background'], ['input', 'card'], ['ring', 'background'], ['ring', 'card']];

const THEMES: Array<[string, string]> = [
  ['dark app theme', ':root'],
  ['light public theme', '.theme-paper'],
  ['high contrast on the dark theme', "html[data-contrast='high']"],
  ['high contrast on the light theme', "html[data-contrast='high'] .theme-paper"],
];

describe('colour contrast of the design tokens', () => {
  for (const [name, selector] of THEMES) {
    const t = tokensIn(selector);
    it(`${name}: text pairs reach 4.5:1`, () => {
      for (const [fg, bg] of TEXT) {
        assert.ok(t[fg] && t[bg], `${selector} is missing --${fg} or --${bg}`);
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 4.5, `${fg} on ${bg} in ${name} is ${r.toFixed(2)}:1`);
      }
    });
    it(`${name}: field borders and focus rings reach 3:1`, () => {
      for (const [fg, bg] of UI) {
        const r = ratio(t[fg], t[bg]);
        assert.ok(r >= 3, `${fg} against ${bg} in ${name} is ${r.toFixed(2)}:1`);
      }
    });
  }

  it('the high-contrast themes are strictly stronger than the defaults for body text', () => {
    const base = tokensIn(':root'), high = tokensIn("html[data-contrast='high']");
    assert.ok(ratio(high.foreground, high.background) > ratio(base.foreground, base.background));
    const baseP = tokensIn('.theme-paper'), highP = tokensIn("html[data-contrast='high'] .theme-paper");
    assert.ok(ratio(highP.foreground, highP.background) > ratio(baseP.foreground, baseP.background));
  });
});
