/**
 * Scroll-to-scene mapping for the landing page "flight": a desk with one paper sheet per step of the
 * daily loop. Each sheet lies nearly flat in the distance, stands up (hinged on its bottom edge) as the
 * camera reaches it, holds while it is read, then lifts away.
 *
 * Pure and dependency-free so it can be tested without a browser. The client component feeds it the
 * scroll progress and writes the result to CSS custom properties; all drawing is CSS.
 */

export const FLIGHT = {
  /** Track progress (0..1) at which the first sheet is fully upright. Earlier, the hero is still on screen. */
  firstFocus: 0.17,
  /** Track progress at which the last sheet is fully upright. */
  lastFocus: 0.95,
  /** Half-width, in sheet units, of the window in which a sheet is fully upright and held still. */
  hold: 0.28,
  /** Distance ahead, in sheet units, at which a sheet has fully lain down. */
  lay: 0.95,
  /** Distance behind, in sheet units, at which a sheet has fully lifted away. */
  leave: 0.6,
  /** Sheets farther ahead than this fade into the haze. */
  hazeStart: 1.7,
  hazeEnd: 3.3,
  /** Largest camera drift, in degrees, reached halfway between two sheets. */
  swayDegrees: 1.6,
} as const;

export type SheetFrame = {
  /** Signed distance from this sheet's focus point, in sheet units. Negative: still ahead of the camera. */
  d: number;
  /** 0 = lying on the desk, 1 = standing and facing the reader. */
  up: number;
  /** 0 = in place, 1 = lifted away after being read. */
  gone: number;
  /** How far the camera has moved past this sheet, in sheet units (0 until it is level). The sheet moves back by this much so it keeps its reading size while it lifts away instead of swelling past the lens. */
  past: number;
  /** Opacity, 0..1. Fades into the haze when far ahead and as the sheet leaves. */
  fog: number;
};

export type FlightFrame = {
  /** Scroll progress through the track, clamped to 0..1. */
  progress: number;
  /** Camera position in sheet units. Sheet i is level with the reader when this equals i. */
  camera: number;
  /** Sideways drift of the camera in degrees. Zero whenever a sheet is in focus, so the page being read is square-on. */
  sway: number;
  /** Index of the sheet in front of the reader, or -1 between sheets. */
  active: number;
  sheets: SheetFrame[];
};

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 0 below `a`, 1 above `b`, smooth in between. */
export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Distance in track progress between two neighbouring sheets' focus points. */
export function sheetStep(count: number): number {
  return count > 1 ? (FLIGHT.lastFocus - FLIGHT.firstFocus) / (count - 1) : FLIGHT.lastFocus - FLIGHT.firstFocus;
}

export function flightFrame(rawProgress: number, count: number): FlightFrame {
  const progress = Number.isFinite(rawProgress) ? clamp(rawProgress, 0, 1) : 0;
  const n = Math.max(0, Math.floor(count));
  const camera = (progress - FLIGHT.firstFocus) / sheetStep(n);

  const sheets: SheetFrame[] = [];
  let active = -1;
  let nearest = Infinity;

  for (let i = 0; i < n; i += 1) {
    const d = camera - i;
    const ahead = Math.max(0, -d);
    const behind = Math.max(0, d);

    const up = 1 - smoothstep(FLIGHT.hold, FLIGHT.lay, ahead);
    const gone = smoothstep(FLIGHT.hold, FLIGHT.leave, behind);
    const hazeFog = 1 - smoothstep(FLIGHT.hazeStart, FLIGHT.hazeEnd, ahead);
    const leaveFog = 1 - smoothstep(FLIGHT.hold + 0.1, FLIGHT.leave, behind);
    const fog = Math.min(hazeFog, leaveFog);

    sheets.push({ d, up, gone, past: behind, fog });

    const distance = Math.abs(d);
    if (distance < 0.6 && distance < nearest) {
      nearest = distance;
      active = i;
    }
  }

  return { progress, camera, sway: Math.sin(camera * Math.PI) * FLIGHT.swayDegrees, active, sheets };
}
