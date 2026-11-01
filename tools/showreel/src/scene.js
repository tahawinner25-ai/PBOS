/*
 * PBOS showreel, "Chaos becomes an operator". 15.000 s, 1920x1080, 136 BPM (34 beats, 8.5 bars).
 *
 * Everything on screen is a pure function of time: window.seek(t) sets every style from t alone.
 * No CSS animation, no transition, no timer, no state carried between calls, so any call order gives
 * the same frame. Nothing here is a number a viewer could mistake for a real metric: bars, lines and
 * words only, and the product scenes carry the caption "Illustrative example".
 *
 * Structure (each scene is made out of the previous one):
 *   bar 0  one idea card breaks into creator chaos      bar 4  one bar leads: the insight
 *   bar 1  an idea becomes a content card (IDEAS)       bar 5  the insight becomes a brand deal (DEALS)
 *   bar 2  cards align into a calendar (POSTS)          bar 6  the deal becomes tracked income (INCOME)
 *   bar 3  the calendar becomes bars that rise to 3D    bar 7  the loop compresses into one command
 *   half bar: title, green CTA, and the CTA shrinks back into the first idea card (seek(15) == seek(0)).
 */
(function () {
  'use strict';

  /* ---------- time ---------- */
  var DUR = 15, BPM = 136, BEAT = 60 / BPM, BAR = 4 * BEAT; // derive every timing from these
  var CX = 960, CY = 540;

  /* ---------- easing: pure functions of progress, no overshoot ---------- */
  var clamp = function (x, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a === undefined ? 0 : a, x)); };
  // exponential ease-out, normalised so f(0)=0 and f(1)=1
  var expOut = function (p, k) { k = k || 6; p = clamp(p); return (1 - Math.exp(-k * p)) / (1 - Math.exp(-k)); };
  // critically damped spring (damping ratio 1): fast start, no bounce; normalised to land exactly on 1
  var spring = function (p, w) { w = w || 11; p = clamp(p); return (1 - (1 + w * p) * Math.exp(-w * p)) / (1 - (1 + w) * Math.exp(-w)); };
  var lerp = function (a, b, p) { return a + (b - a) * p; };

  /* ---------- the pieces: 21 rounded rectangles that morph from scene to scene ---------- */
  var NP = 21;
  var PARK = { x: CX, y: CY, w: 0, h: 0, r: 0, rad: 24 };
  var rect = function (x, y, w, h, r, rad) { return { x: x, y: y, w: w, h: h, r: r || 0, rad: rad === undefined ? 24 : rad }; };
  var parkAt = function (x, y) { return { x: x, y: y, w: 0, h: 0, r: 0, rad: 24 }; };

  // scattered "creator chaos": x, y, w, h, rotation, kind. P0 is the idea; P1..P20 are the rest.
  var CH = [
    [90, 70, 330, 190, -8, 'idea'], [520, 40, 300, 170, 5, 'draft'], [940, 90, 280, 160, -4, 'metric'], [1380, 60, 340, 190, 9, 'deal'], [1620, 320, 260, 170, -6, 'invoice'],
    [60, 340, 280, 170, 6, 'metric'], [330, 250, 250, 150, -10, 'invoice'], [1330, 330, 260, 150, 7, 'idea'], [120, 640, 320, 190, -5, 'deal'], [470, 770, 300, 170, 8, 'draft'],
    [900, 810, 260, 160, -7, 'idea'], [1300, 750, 330, 190, 5, 'metric'], [1640, 650, 250, 170, -9, 'draft'], [780, 20, 200, 120, 12, 'idea'], [40, 890, 260, 150, 4, 'invoice'],
    [1580, 910, 280, 150, -4, 'idea'], [700, 890, 220, 130, 10, 'deal'], [1120, 900, 240, 130, -6, 'draft'], [250, 510, 220, 130, -3, 'metric'], [1500, 520, 230, 140, 5, 'invoice']
  ];

  var S = []; // S[k][i]: where piece i rests after scene k
  var CARD0 = rect(650, 390, 620, 300, 0, 24);

  // k0: chaos
  S[0] = [CARD0].concat(CH.map(function (c) { return rect(c[0], c[1], c[2], c[3], c[4], 22); }));

  // k1: the idea becomes a content card; everything else drifts outward and shrinks
  S[1] = S[0].map(function (s, i) {
    if (i === 0) return rect(460, 440, 1000, 540, 0, 28);
    var cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    var nx = CX + (cx - CX) * 1.4, ny = CY + (cy - CY) * 1.4, nw = s.w * 0.55, nh = s.h * 0.55;
    return rect(nx - nw / 2, ny - nh / 2, nw, nh, s.r, 16);
  });

  // k2: a posting calendar, 7 x 3. Piece i lands on cell (i + 10) % 21, so the idea lands near the middle.
  var cell = function (j) { var c = j % 7, r = Math.floor(j / 7); return rect(160 + c * 231, 480 + r * 168, 213, 150, 0, 16); };
  var cellOf = function (i) { return (i + 10) % 21; };
  S[2] = S[1].map(function (s, i) { return cell(cellOf(i)); });

  // k3: six bars on a baseline (P1, P2, P0, P3, P4, P5 left to right); the rest drop onto the baseline and vanish
  var BASE = 984, BAR_W = 150, BAR_GAP = 70, BAR_X0 = 335;
  var BAR_H = [260, 340, 560, 330, 420, 300]; // abstract heights: no numbers are ever drawn
  var BAR_PIECE = [1, 2, 0, 3, 4, 5];
  var barSlot = function (i) { return BAR_PIECE.indexOf(i); };
  S[3] = S[2].map(function (s, i) {
    var n = barSlot(i);
    if (n >= 0) return rect(BAR_X0 + n * (BAR_W + BAR_GAP), BASE - BAR_H[n], BAR_W, BAR_H[n], 0, 10);
    return parkAt(s.x + s.w / 2, BASE);
  });

  // k4: bars narrow to the left, one clear insight card on the right
  var B4 = { x0: 160, w: 100, gap: 40 };
  S[4] = S[3].map(function (s, i) {
    var n = barSlot(i);
    if (n >= 0) { var h = BAR_H[n] * 0.9; return rect(B4.x0 + n * (B4.w + B4.gap), BASE - h, B4.w, h, 0, 10); }
    if (i === 6) return rect(1130, 470, 640, 440, 0, 28);
    return s;
  });

  // k5: the insight becomes a brand deal: the lead bar is the deal card, three stage chips sit on it
  S[5] = S[4].map(function (s, i) {
    if (i === 0) return rect(420, 440, 1080, 520, 0, 28);
    if (i >= 7 && i <= 9) return rect(500 + (i - 7) * 330, 840, 300, 84, 0, 42);
    if (i >= 1 && i <= 6) return parkAt(960, 700);
    return s;
  });

  // k6: the deal becomes tracked income: one line, three ticks, one "Paid" chip
  S[6] = S[5].map(function (s, i) {
    if (i === 0) return rect(260, 620, 1400, 22, 0, 11);
    if (i >= 7 && i <= 9) return rect(520 + (i - 7) * 340, 560, 14, 142, 0, 7);
    if (i === 10) return rect(1027, 478, 360, 84, 0, 42);
    return s;
  });

  // k7: everything compresses into one command bar
  S[7] = S[6].map(function (s, i) {
    if (i === 0) return rect(330, 470, 1260, 140, 0, 70);
    return PARK;
  });
  var CTA = rect(680, 586, 560, 116, 0, 58);
  var OPEN = [2, 5, 9, 12, 14, 18, 20]; // calendar slots drawn as "Open" (no post scheduled)
  S[8] = S[7].map(function (s, i) { return i === 0 ? CARD0 : PARK; });

  /* ---------- transitions: spring from one resting state to the next ---------- */
  var T = [0, BAR, 2 * BAR, 3 * BAR, 4 * BAR, 5 * BAR, 6 * BAR, 7 * BAR];
  var T_CTA = 13.78, T_BACK = 14.6; // after the command is typed: CTA + title appear, then the CTA folds back into the first idea card
  var same = function (a, b) { return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h && a.r === b.r && a.rad === b.rad; };

  var TR = [];
  for (var i = 0; i < NP; i++) {
    var list = [];
    var from = i === 0 ? S[0][0] : PARK;
    if (i > 0) list.push({ t0: ((i - 1) % 4) * BEAT + 0.03, dur: 0.72, a: PARK, b: S[0][i], w: 9 }); // fan out, a group per beat
    for (var k = 1; k <= 7; k++) {
      var a = S[k - 1][i], b = S[k][i];
      if (same(a, b)) continue;
      var delay = ((i * 7 + k * 3) % 8) * 0.026;
      list.push({ t0: T[k] + delay, dur: 0.66, a: a, b: b, w: 10 });
    }
    if (i === 0) {
      list.push({ t0: T_CTA, dur: 0.42, a: S[7][0], b: CTA, w: 12 });
      list.push({ t0: T_BACK, dur: 0.38, a: CTA, b: S[8][0], w: 12 });
    }
    TR.push(list);
  }

  function stateAt(i, t) {
    var list = TR[i], cur = i === 0 ? S[0][0] : PARK;
    for (var q = 0; q < list.length; q++) {
      var x = list[q];
      if (t < x.t0) return cur;
      var p = (t - x.t0) / x.dur;
      if (p < 1) {
        var e = spring(p, x.w);
        return { x: lerp(x.a.x, x.b.x, e), y: lerp(x.a.y, x.b.y, e), w: lerp(x.a.w, x.b.w, e), h: lerp(x.a.h, x.b.h, e), r: lerp(x.a.r, x.b.r, e), rad: lerp(x.a.rad, x.b.rad, e) };
      }
      cur = x.b;
    }
    return cur;
  }

  /* ---------- skins: what is drawn inside a piece. Horizontal sizes and type use cqw, vertical positions use cqh, so a skin
     follows the piece it lives on. Every layer is opaque, so a wipe replaces whatever is under it. ---------- */
  var L = function (cls, css, html) { return '<div class="' + cls + '" style="' + css + '">' + (html || '') + '</div>'; };
  var CHIP = 'line-height:1;';
  var skins = {
    idea: function () {
      return L('lbl', 'left:7cqw;top:9cqh;font-size:4.2cqw', 'Idea') +
        L('tx wrap', 'left:7cqw;top:22cqh;width:86cqw;font-size:8cqw;font-weight:800;letter-spacing:-.03em', 'A hook worth testing') +
        L('ln', 'left:7cqw;top:70cqh;width:62cqw;height:3.4cqh') +
        L('ln', 'left:7cqw;top:81cqh;width:44cqw;height:3.4cqh');
    },
    draft: function () {
      return L('lbl', 'left:7cqw;top:9cqh;font-size:4.2cqw', 'Draft') +
        L('blk', 'left:7cqw;top:27cqh;width:86cqw;height:38cqh') +
        L('ln', 'left:7cqw;top:74cqh;width:60cqw;height:3.4cqh') +
        L('ln', 'left:7cqw;top:84cqh;width:34cqw;height:3.4cqh');
    },
    metric: function () {
      var bars = '', hs = [22, 36, 28, 46, 32];
      for (var n = 0; n < 5; n++) bars += L('blk', 'left:' + (8 + n * 16) + 'cqw;top:' + (90 - hs[n]) + 'cqh;width:11cqw;height:' + hs[n] + 'cqh;border-radius:1.6cqw;background:rgba(11,11,12,.16)');
      return L('lbl', 'left:7cqw;top:9cqh;font-size:4.2cqw', 'Views') + bars;
    },
    deal: function () {
      return L('lbl', 'left:7cqw;top:9cqh;font-size:4.2cqw', 'Deal') +
        L('blk', 'left:7cqw;top:30cqh;width:22cqw;height:40cqh;border-radius:2cqw') +
        L('ln', 'left:34cqw;top:36cqh;width:50cqw;height:5cqh') +
        L('ln', 'left:34cqw;top:50cqh;width:32cqw;height:5cqh');
    },
    invoice: function () {
      return L('lbl', 'left:7cqw;top:9cqh;font-size:4.2cqw', 'Invoice') +
        L('ln', 'left:7cqw;top:32cqh;width:80cqw;height:3.4cqh') +
        L('ln', 'left:7cqw;top:43cqh;width:70cqw;height:3.4cqh') +
        L('ln', 'left:7cqw;top:54cqh;width:50cqw;height:3.4cqh') +
        L('chip', 'left:7cqw;top:68cqh;font-size:4cqw;padding:1.2cqh 4cqw;' + CHIP, 'Unpaid');
    },
    post: function (n) { // one calendar cell: a scheduled post, or an open slot
      if (OPEN.indexOf(n) >= 0) return L('lbl', 'left:9cqw;top:12cqh;font-size:6cqw', 'Open') + L('ln', 'left:9cqw;top:38cqh;width:46cqw;height:5cqh');
      return L('lbl', 'left:9cqw;top:12cqh;font-size:6cqw', n % 2 ? 'Instagram' : 'YouTube') +
        L('blk', 'left:9cqw;top:34cqh;width:82cqw;height:30cqh') +
        L('ln', 'left:9cqw;top:74cqh;width:58cqw;height:5cqh') +
        L('ln', 'left:9cqw;top:85cqh;width:32cqw;height:5cqh');
    },
    content: function () {
      return L('lbl', 'left:5cqw;top:7cqh;font-size:2.2cqw', 'Content card') +
        L('tx', 'right:5cqw;top:7.6cqh;font-size:2.2cqw;color:var(--grey);font-weight:500', 'Next: schedule it') +
        L('tx wrap', 'left:5cqw;top:15cqh;width:62cqw;font-size:6cqw;font-weight:800;letter-spacing:-.03em', 'A hook worth testing') +
        L('chip', 'left:5cqw;top:44cqh;font-size:2.4cqw;padding:1cqh 2.4cqw;' + CHIP, 'YouTube') +
        L('chip', 'left:21cqw;top:44cqh;font-size:2.4cqw;padding:1cqh 2.4cqw;' + CHIP, 'Instagram') +
        L('blk', 'left:5cqw;top:57cqh;width:90cqw;height:26cqh;border-radius:2cqw') +
        L('ln', 'left:5cqw;top:89cqh;width:56cqw;height:1.8cqh') +
        L('ln', 'left:5cqw;top:94cqh;width:36cqw;height:1.8cqh');
    },
    plain: function () { return ''; },
    insight: function () {
      return L('lbl', 'left:7cqw;top:8cqh;font-size:3.4cqw', 'Insight') +
        L('tx wrap', 'left:7cqw;top:18cqh;width:86cqw;font-size:8.4cqw;font-weight:800;letter-spacing:-.035em', 'This post leads the six shown.') +
        L('ln', 'left:7cqw;top:55cqh;width:60cqw;height:1.2cqh') +
        L('tx wrap', 'left:7cqw;top:60cqh;width:86cqw;font-size:5.2cqw;color:var(--grey);font-weight:500', 'Next: draft one more like it.') +
        L('chip', 'left:7cqw;top:82cqh;font-size:3.4cqw;padding:1.2cqh 3.6cqw;' + CHIP, 'Suggested action');
    },
    dealCard: function () {
      return L('lbl', 'left:5cqw;top:7cqh;font-size:2.4cqw', 'Brand deal') +
        L('blk', 'left:5cqw;top:19cqh;width:13cqw;height:27cqh;border-radius:2.4cqw') +
        L('tx', 'left:21.5cqw;top:19cqh;font-size:5cqw;font-weight:800;letter-spacing:-.03em', 'Brand name') +
        L('tx', 'left:21.5cqw;top:34cqh;font-size:2.7cqw;color:var(--grey);font-weight:500', 'Opportunity from your top post') +
        L('ln', 'left:5cqw;top:55cqh;width:90cqw;height:.8cqh') +
        L('tx', 'left:5cqw;top:61cqh;font-size:2.3cqw;color:var(--grey);font-weight:500', 'Stage');
    },
    center: function (label, css) {
      return L('tx', 'left:0;top:0;width:100cqw;height:100cqh;display:flex;align-items:center;justify-content:center;' + css, label);
    }
  };

  // each piece: a list of skin layers {html, t, bg, border}. Layer 0 is always visible; later layers wipe in from the bottom at t.
  var WIPE = 0.3;
  function layersFor(i) {
    var kind = i === 0 ? 'idea' : CH[i - 1][5];
    var base = { html: skins[kind](), t: -1 };
    var jit = function (k) { return ((i * 7 + k * 3) % 8) * 0.026; }; // the same stagger the piece's move uses
    var INK = { bg: 'var(--ink)', border: 'transparent' };
    if (i === 0) {
      return [base,
        { html: skins.content(), t: T[1] + 0.08 },
        { html: skins.post(cellOf(0)), t: T[2] + 0.1 },
        { html: skins.plain(), t: T[3] + 0.1 },
        { html: skins.plain(), t: T[4] + 0.12, bg: INK.bg, border: INK.border },
        { html: skins.dealCard(), t: T[5] + 0.1 },
        { html: skins.plain(), t: T[6] + 0.08, bg: INK.bg, border: INK.border },
        { html: skins.plain(), t: T[7] + 0.04 },
        { html: skins.center('Launch your brand →', 'font-size:36cqh;color:#fff;font-weight:600;letter-spacing:-.01em'), t: T_CTA + 0.08, bg: 'var(--green)', border: 'transparent' },
        { html: skins.idea(), t: T_BACK + 0.06 }];
    }
    var out = [base, { html: skins.post(cellOf(i)), t: T[2] + 0.08 + jit(2) }];
    if (barSlot(i) >= 0) out.push({ html: skins.plain(), t: T[3] + 0.1 + jit(3) });
    if (i === 6) out.push({ html: skins.insight(), t: T[4] + 0.12 + jit(4) });
    if (i >= 7 && i <= 9) {
      var names = ['Prospecting', 'Talking', 'Won'];
      out.push({ html: skins.center(names[i - 7], 'font-size:36cqh;' + (i === 7 ? '' : 'color:var(--grey)')), t: T[5] + 0.1 + jit(5) });
      out.push({ html: skins.plain(), t: T[6] + 0.08 + jit(6), bg: INK.bg, border: INK.border });
    }
    if (i === 10) out.push({ html: skins.center('✓ You mark it paid', 'font-size:34cqh'), t: T[6] + 0.12 + jit(6) });
    return out;
  }

  /* ---------- DOM ---------- */
  var stage = document.getElementById('stage'), plane = document.getElementById('plane'), hud = document.getElementById('hud');
  var pieces = [];
  for (var pi = 0; pi < NP; pi++) {
    var el = document.createElement('div'); el.className = 'a piece';
    el.style.zIndex = String(pi === 0 ? 20 : (pi >= 7 && pi <= 10 ? 30 : pi));
    var front = document.createElement('div'); front.className = 'front';
    var top = document.createElement('div'); top.className = 'face tf'; top.style.background = '#ECECE8'; top.style.transformOrigin = '0 0'; top.style.display = 'none';
    var side = document.createElement('div'); side.className = 'face sf'; side.style.background = '#DCDCD7'; side.style.transformOrigin = '0 0'; side.style.display = 'none';
    var layerDefs = layersFor(pi), layerEls = [];
    layerDefs.forEach(function (ld, idx) {
      var s = document.createElement('div'); s.className = 'skin'; s.innerHTML = ld.html;
      if (ld.bg) s.style.background = ld.bg;
      front.appendChild(s); layerEls.push(s);
    });
    el.appendChild(top); el.appendChild(side); el.appendChild(front); plane.appendChild(el);
    pieces.push({ el: el, front: front, top: top, side: side, defs: layerDefs, els: layerEls, shown: true });
  }

  // baseline under the bars (lives in the 3D plane so it tilts with them)
  var baseline = document.createElement('div'); baseline.className = 'a'; baseline.style.cssText = 'left:0;top:0;height:4px;background:rgba(11,11,12,.28);border-radius:2px;transform-origin:0 0';
  plane.appendChild(baseline);

  // kinetic words and small HUD text: letters in clipped slots, rolled in and out from below
  function makeWord(text, size, x, y, color) {
    var wrap = document.createElement('div'); wrap.className = 'hw word'; wrap.style.cssText = 'left:' + x + 'px;top:' + y + 'px;font-size:' + size + 'px;color:' + (color || 'var(--ink)');
    var letters = [];
    for (var c = 0; c < text.length; c++) {
      var ch = text[c];
      var slot = document.createElement('span'); slot.className = 'letter'; slot.style.cssText = 'display:inline-block;overflow:hidden;vertical-align:top;height:' + (size * 1.0) + 'px;line-height:' + (size * 1.0) + 'px;padding-right:0';
      var inner = document.createElement('span'); inner.style.cssText = 'display:block;will-change:transform'; inner.textContent = ch === ' ' ? ' ' : ch;
      slot.appendChild(inner); wrap.appendChild(slot); letters.push(inner);
    }
    hud.appendChild(wrap);
    return { wrap: wrap, letters: letters, n: text.length };
  }
  // roll: letter c enters at t0 + c*gap and leaves at t1 + c*gap2 (t1 = null: stays)
  function rollWord(w, t, t0, t1, gap, gap2) {
    var ty;
    for (var c = 0; c < w.n; c++) {
      var pin = expOut((t - (t0 + c * gap)) / 0.36, 6);
      ty = (1 - pin) * 112;
      if (t1 !== null) { var pout = expOut((t - (t1 + c * gap2)) / 0.3, 5); ty = pout > 0 ? -pout * 112 : ty; }
      w.letters[c].style.transform = 'translate3d(0,' + ty.toFixed(2) + '%,0)';
    }
    w.wrap.style.display = (t < t0 || (t1 !== null && t > t1 + w.n * gap2 + 0.35)) ? 'none' : 'block';
  }

  var WORDS = [
    { w: makeWord('IDEAS', 212, 120, 100), a: T[1], b: T[2] - 0.36 },
    { w: makeWord('POSTS', 212, 120, 100), a: T[2], b: T[3] - 0.36 },
    { w: makeWord('PERFORMANCE', 212, 120, 100), a: T[3], b: T[5] - 0.36 },
    { w: makeWord('DEALS', 212, 120, 100), a: T[5], b: T[6] - 0.36 },
    { w: makeWord('INCOME', 212, 120, 100), a: T[6], b: T[7] - 0.36 }
  ];
  var CAPTION = makeWord('Illustrative example', 24, 120, 1010, 'var(--grey)'); CAPTION.wrap.style.fontWeight = '600'; CAPTION.wrap.style.letterSpacing = '0';
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(function (d, c) { return makeWord(d, 24, 160 + c * 231 + 4, 438, 'var(--grey)'); });
  DAYS.forEach(function (d) { d.wrap.style.fontWeight = '600'; d.wrap.style.letterSpacing = '.06em'; });
  var CMD = []; // "Scan  ->  Flag  ->  Draft  ->  Send", one word per beat
  var CMD_TEXT = ['Scan', '→ Flag', '→ Draft', '→ Send'], cmdX = [445, 690, 955, 1245];
  CMD_TEXT.forEach(function (txt, n) { var w = makeWord(txt, 66, cmdX[n], 506, n === 3 ? 'var(--green)' : 'var(--ink)'); w.wrap.style.fontWeight = '600'; w.wrap.style.letterSpacing = '-.02em'; CMD.push(w); });
  var APPROVE = makeWord('You approve every send.', 34, 0, 650, 'var(--grey)'); APPROVE.wrap.style.fontWeight = '500'; APPROVE.wrap.style.letterSpacing = '0'; APPROVE.wrap.style.width = '1920px'; APPROVE.wrap.style.textAlign = 'center';
  var TITLE = makeWord('PBOS — Personal Brand Operating System', 62, 0, 405, 'var(--ink)'); TITLE.wrap.style.width = '1920px'; TITLE.wrap.style.textAlign = 'center'; TITLE.wrap.style.letterSpacing = '-.03em';
  // tick labels under the income line
  var TICKS = ['Won', 'Invoiced', 'Paid'].map(function (s, n) { var w = makeWord(s, 26, 427 + n * 340, 730, 'var(--grey)'); w.wrap.style.fontWeight = '600'; w.wrap.style.width = '200px'; w.wrap.style.textAlign = 'center'; return w; });

  /* ---------- camera: slow lateral drift (period 15 s, so it closes the loop) and the 3D tilt ---------- */
  function tiltAmount(t) {
    var inn = spring((t - (T[3] + 0.5)) / 0.8, 8), out = spring((t - (T[4] + 0.12)) / 0.62, 9);
    return clamp(inn - out);
  }
  function depthAmount(t) {
    var inn = spring((t - (T[3] + 0.42)) / 0.7, 8), out = spring((t - (T[4] + 0.1)) / 0.62, 9);
    return clamp(inn - out);
  }

  /* ---------- the frame ---------- */
  function seek(t) {
    t = clamp(t, 0, DUR);
    var ph = (t / DUR) * Math.PI * 2;
    var dx = 34 * Math.sin(ph), dy = 12 * Math.sin(2 * ph + 0.6);
    var tilt = tiltAmount(t), dep = depthAmount(t) * 120;
    plane.style.transformOrigin = '960px 820px';
    plane.style.transform = 'translate3d(' + dx.toFixed(3) + 'px,' + dy.toFixed(3) + 'px,0) rotateX(' + (14 * tilt).toFixed(3) + 'deg) rotateY(' + (-30 * tilt).toFixed(3) + 'deg)';

    for (var i = 0; i < NP; i++) {
      var p = pieces[i], s = stateAt(i, t);
      var vis = s.w >= 2 && s.h >= 2;
      if (!vis) { if (p.shown) { p.el.style.display = 'none'; p.shown = false; } continue; }
      if (!p.shown) { p.el.style.display = 'block'; p.shown = true; }
      p.el.style.width = s.w.toFixed(2) + 'px'; p.el.style.height = s.h.toFixed(2) + 'px';
      p.el.style.transform = 'translate3d(' + s.x.toFixed(2) + 'px,' + s.y.toFixed(2) + 'px,0) rotate(' + s.r.toFixed(3) + 'deg)';
      p.front.style.borderRadius = s.rad.toFixed(2) + 'px';
      // skin layers: wipe in from the bottom, newest on top
      var lastFull = -1;
      for (var q = 0; q < p.defs.length; q++) {
        var d = p.defs[q], e = p.els[q];
        var wp = q === 0 ? 1 : expOut((t - d.t) / WIPE, 5);
        if (wp >= 1) lastFull = q;
        if (q === 0) { e.style.display = 'block'; e.style.clipPath = 'none'; continue; }
        if (wp <= 0) { e.style.display = 'none'; continue; }
        e.style.display = 'block'; e.style.clipPath = wp >= 1 ? 'none' : 'inset(' + ((1 - wp) * 100).toFixed(2) + '% 0 0 0)';
      }
      // border colour follows the newest layer that has started
      var bc = '';
      for (var q2 = p.defs.length - 1; q2 >= 0; q2--) { if (q2 === 0 || t >= p.defs[q2].t) { bc = p.defs[q2].border || ''; break; } }
      p.front.style.borderColor = bc;
      // extrusion for the 3D moment (bars only)
      var n = barSlot(i), d3 = n >= 0 ? dep : 0;
      if (d3 > 0.5) {
        p.top.style.display = 'block'; p.side.style.display = 'block';
        p.top.style.width = s.w.toFixed(2) + 'px'; p.top.style.height = d3.toFixed(2) + 'px'; p.top.style.transform = 'rotateX(-90deg)';
        p.side.style.left = s.w.toFixed(2) + 'px'; p.side.style.width = d3.toFixed(2) + 'px'; p.side.style.height = s.h.toFixed(2) + 'px'; p.side.style.transform = 'rotateY(90deg)';
      } else { p.top.style.display = 'none'; p.side.style.display = 'none'; }
    }

    // baseline: draws in under the bars, leaves with them
    var bl = clamp(spring((t - (T[3] + 0.2)) / 0.6, 9)) - clamp(spring((t - (T[5] + 0.05)) / 0.5, 9));
    var bx0 = t < T[4] ? 300 : 120, bw = (t < T[4] ? 1320 : 880) * clamp(bl);
    baseline.style.display = bl > 0.002 ? 'block' : 'none';
    baseline.style.width = bw.toFixed(2) + 'px'; baseline.style.transform = 'translate3d(' + bx0 + 'px,' + (BASE + 8) + 'px,0)';

    // words
    for (var w = 0; w < WORDS.length; w++) rollWord(WORDS[w].w, t, WORDS[w].a + 0.05, WORDS[w].b, 0.045, 0.03);
    rollWord(CAPTION, t, T[1] + 0.2, T[7] - 0.3, 0.012, 0.01);
    for (var dd = 0; dd < 7; dd++) rollWord(DAYS[dd], t, T[2] + 0.35 + dd * 0.03, T[3] + 0.05, 0.01, 0.01);
    for (var cc = 0; cc < 4; cc++) rollWord(CMD[cc], t, T[7] + 0.35 + cc * BEAT / 2, T_CTA - 0.1 + cc * 0.02, 0.012, 0.01);
    rollWord(APPROVE, t, 13.46, T_CTA - 0.08, 0.008, 0.008);
    rollWord(TITLE, t, T_CTA + 0.02, T_BACK - 0.25, 0.006, 0.004);
    for (var tk = 0; tk < 3; tk++) rollWord(TICKS[tk], t, T[6] + 0.45 + tk * 0.08, T[7] - 0.28, 0.01, 0.008);
  }

  window.seek = seek;
  window.PBOS_SHOWREEL = { DUR: DUR, BPM: BPM, BEAT: BEAT, BAR: BAR, T: T, T_CTA: T_CTA, T_BACK: T_BACK };

  /* ---------- live preview (?live=1): real time, scaled to the window, looping. Rendering never uses this. ---------- */
  var q = new URLSearchParams(location.search);
  function fit() {
    var sc = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = 'translate(' + ((innerWidth - 1920 * sc) / 2) + 'px,' + ((innerHeight - 1080 * sc) / 2) + 'px) scale(' + sc + ')';
  }
  if (q.get('live') === '1') {
    fit(); addEventListener('resize', fit);
    var t0 = performance.now();
    (function frame(now) { seek(((now - t0) / 1000) % DUR); requestAnimationFrame(frame); })(t0);
  } else {
    seek(0);
  }
})();
