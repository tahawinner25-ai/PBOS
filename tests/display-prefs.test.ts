import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyPrefs, ATTRIBUTES, DEFAULT_PREFS, DISPLAY_INIT_SCRIPT, DISPLAY_STORAGE_KEY, isDefault, parsePrefs } from '../src/lib/display-prefs';

describe('display preferences', () => {
  it('falls back to defaults for nothing, garbage, arrays and wrong types', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"large"', '42', 'null']) assert.deepEqual(parsePrefs(raw), DEFAULT_PREFS, String(raw));
  });

  it('keeps valid values and replaces invalid ones field by field', () => {
    const p = parsePrefs(JSON.stringify({ textSize: 'larger', contrast: 'extreme', font: 'readable', motion: 7, extra: '<script>' }));
    assert.deepEqual(p, { textSize: 'larger', contrast: 'default', font: 'readable', motion: 'system' });
    assert.equal(Object.keys(p).length, 4, 'unknown keys are dropped');
  });

  it('writes attributes for choices and removes them for defaults', () => {
    const attrs = new Map<string, string>();
    const root = { setAttribute: (k: string, v: string) => void attrs.set(k, v), removeAttribute: (k: string) => void attrs.delete(k) };
    applyPrefs(root, { textSize: 'large', contrast: 'high', font: 'readable', motion: 'reduce' });
    assert.equal(attrs.get(ATTRIBUTES.textSize), 'large');
    assert.equal(attrs.get(ATTRIBUTES.contrast), 'high');
    assert.equal(attrs.get(ATTRIBUTES.font), 'readable');
    assert.equal(attrs.get(ATTRIBUTES.motion), 'reduce');
    applyPrefs(root, DEFAULT_PREFS);
    assert.equal(attrs.size, 0);
  });

  it('knows when everything is default', () => {
    assert.equal(isDefault(DEFAULT_PREFS), true);
    assert.equal(isDefault({ ...DEFAULT_PREFS, font: 'readable' }), false);
  });

  it('the head script applies the same choices as parsePrefs and ignores anything else', () => {
    function run(stored: string | null) {
      const attrs = new Map<string, string>();
      const document = { documentElement: { setAttribute: (k: string, v: string) => void attrs.set(k, v) } };
      const localStorage = { getItem: (k: string) => (k === DISPLAY_STORAGE_KEY ? stored : null) };
      new Function('document', 'localStorage', DISPLAY_INIT_SCRIPT)(document, localStorage);
      return Object.fromEntries(attrs);
    }
    assert.deepEqual(run(JSON.stringify({ textSize: 'largest', contrast: 'high', font: 'readable', motion: 'reduce' })), { 'data-text-size': 'largest', 'data-contrast': 'high', 'data-font': 'readable', 'data-motion': 'reduce' });
    assert.deepEqual(run(JSON.stringify({ textSize: '"><img src=x onerror=alert(1)>', contrast: 'default' })), {});
    assert.deepEqual(run('{broken'), {});
    assert.deepEqual(run(null), {});
    // A browser that blocks storage throws; the script must swallow it.
    assert.doesNotThrow(() => new Function('document', 'localStorage', DISPLAY_INIT_SCRIPT)({ documentElement: { setAttribute() {} } }, { getItem() { throw new Error('blocked'); } }));
  });
});
