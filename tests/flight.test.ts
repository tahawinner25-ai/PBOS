import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLIGHT, clamp, flightFrame, sheetStep, smoothstep } from '../src/lib/flight';

const focusAt = (i: number, count: number) => FLIGHT.firstFocus + i * sheetStep(count);

describe('smoothstep and clamp', () => {
  it('clamps and eases between the edges', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(smoothstep(0, 1, -1), 0);
    assert.equal(smoothstep(0, 1, 2), 1);
    assert.equal(smoothstep(0, 1, 0.5), 0.5);
  });

  it('does not divide by zero when the edges meet', () => {
    assert.equal(smoothstep(1, 1, 0.5), 0);
    assert.equal(smoothstep(1, 1, 1.5), 1);
  });
});

describe('flightFrame', () => {
  const count = 5;

  it('puts the first sheet nearly flat and nothing in focus when the page opens', () => {
    const f = flightFrame(0, count);
    assert.equal(f.active, -1);
    assert.ok(f.sheets[0].up < 0.1, `first sheet should lie on the desk, up=${f.sheets[0].up}`);
    assert.equal(f.sheets[0].gone, 0);
    assert.ok(f.sheets[0].fog > 0.9, 'the first sheet is visible on the desk');
  });

  it('hides sheets that are far ahead in the haze', () => {
    const f = flightFrame(0, count);
    assert.equal(f.sheets[4].fog, 0);
    assert.equal(f.sheets[3].fog, 0);
  });

  it('stands each sheet upright, in place and opaque at its own focus point', () => {
    for (let i = 0; i < count; i += 1) {
      const f = flightFrame(focusAt(i, count), count);
      assert.equal(f.active, i);
      assert.ok(Math.abs(f.sheets[i].d) < 1e-9);
      assert.equal(f.sheets[i].up, 1);
      assert.equal(f.sheets[i].gone, 0);
      assert.equal(f.sheets[i].fog, 1);
    }
  });

  it('keeps the camera square-on at every focus point and drifts between them', () => {
    for (let i = 0; i < count; i += 1) assert.ok(Math.abs(flightFrame(focusAt(i, count), count).sway) < 1e-6);
    const between = flightFrame((focusAt(1, count) + focusAt(2, count)) / 2, count);
    assert.ok(Math.abs(between.sway) > FLIGHT.swayDegrees * 0.99);
  });

  it('holds a sheet still across the hold window', () => {
    const step = sheetStep(count);
    for (const offset of [-FLIGHT.hold, 0, FLIGHT.hold]) {
      const f = flightFrame(focusAt(2, count) + offset * step, count);
      assert.equal(f.sheets[2].up, 1);
      assert.equal(f.sheets[2].gone, 0);
    }
  });

  it('lifts a sheet away once the camera has passed it', () => {
    const step = sheetStep(count);
    const f = flightFrame(focusAt(1, count) + 0.95 * step, count);
    assert.equal(f.sheets[1].gone, 1);
    assert.equal(f.sheets[1].fog, 0);
    assert.equal(f.sheets[2].up > 0.9, true, 'the next sheet is nearly upright');
  });

  it('moves a sheet back by exactly the distance the camera has passed it', () => {
    const f = flightFrame(focusAt(2, count) + 0.5 * sheetStep(count), count);
    assert.ok(Math.abs(f.sheets[2].past - 0.5) < 1e-9);
    assert.equal(f.sheets[3].past, 0, 'a sheet still ahead has not been passed');
    assert.equal(flightFrame(0, count).sheets[0].past, 0);
  });

  it('has finished lifting one sheet by the time the next is standing', () => {
    const f = flightFrame(focusAt(1, count) + (1 - FLIGHT.hold) * sheetStep(count), count);
    assert.equal(f.sheets[2].up, 1);
    assert.equal(f.sheets[1].gone, 1);
    assert.equal(f.sheets[1].fog, 0);
  });

  it('keeps the last sheet standing at the end of the track', () => {
    const f = flightFrame(1, count);
    assert.equal(f.sheets[4].up, 1);
    assert.equal(f.sheets[4].gone, 0);
    assert.equal(f.sheets[4].fog, 1);
  });

  it('keeps every value inside its range for any progress', () => {
    for (let p = -0.5; p <= 1.5; p += 0.013) {
      const f = flightFrame(p, count);
      assert.ok(f.progress >= 0 && f.progress <= 1);
      assert.ok(Math.abs(f.sway) <= FLIGHT.swayDegrees + 1e-9);
      for (const s of f.sheets) {
        for (const v of [s.up, s.gone, s.fog]) assert.ok(v >= 0 && v <= 1, `out of range at p=${p}: ${v}`);
      }
    }
  });

  it('never has two sheets in focus at once and moves focus in order', () => {
    let last = -1;
    for (let p = 0; p <= 1; p += 0.002) {
      const f = flightFrame(p, count);
      if (f.active >= 0) {
        assert.ok(f.active >= last, `focus went backwards at p=${p}`);
        last = f.active;
      }
    }
    assert.equal(last, count - 1);
  });

  it('survives bad input and an empty list', () => {
    assert.equal(flightFrame(Number.NaN, count).progress, 0);
    assert.equal(flightFrame(Infinity, count).progress, 0);
    const empty = flightFrame(0.5, 0);
    assert.deepEqual(empty.sheets, []);
    assert.equal(empty.active, -1);
  });

  it('works with a single sheet', () => {
    const f = flightFrame(FLIGHT.firstFocus, 1);
    assert.equal(f.sheets.length, 1);
    assert.equal(f.sheets[0].up, 1);
  });
});
