'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { flightFrame } from '@/lib/flight';

/** Ruled lines on the desk. They only mark distance as the camera moves; they carry no information. */
const DESK_LINES = Array.from({ length: 54 }, (_, k) => k);

type FlightProps = {
  /** The page's opening copy. It scrolls away over the first frame of the scene. */
  hero: ReactNode;
  /** One short name per sheet, shown in the progress index. */
  labels: readonly string[];
  /** One `<li data-slot>` per sheet. */
  children: ReactNode;
};

/**
 * Scroll-driven 3D scene made of plain DOM and CSS transforms (no WebGL, no extra dependency).
 *
 * The server renders a flat, readable stack: the hero, then each sheet in order. Once this component
 * mounts it switches the section to `data-flight="on"` unless the visitor prefers reduced motion, and
 * from then on only writes CSS custom properties (--cam, --sway, and --up/--gone/--past/--fog per sheet).
 * Everything that looks three-dimensional lives in globals.css under `.flight[data-flight='on']`.
 */
export function Flight({ hero, labels, children }: FlightProps) {
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const slots = Array.from(root.querySelectorAll<HTMLElement>('[data-slot]'));
    const rail = Array.from(root.querySelectorAll<HTMLElement>('[data-rail]'));
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frameId = 0;
    let shownActive = -2;

    const clearVars = () => {
      root.style.removeProperty('--cam');
      root.style.removeProperty('--sway');
      for (const slot of slots) {
        slot.style.removeProperty('--up');
        slot.style.removeProperty('--gone');
        slot.style.removeProperty('--past');
        slot.style.removeProperty('--fog');
      }
      for (const item of rail) item.removeAttribute('data-on');
      shownActive = -2;
    };

    const paint = () => {
      frameId = 0;
      const rect = root.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const frame = flightFrame(travel > 0 ? -rect.top / travel : 0, slots.length);

      root.style.setProperty('--cam', frame.camera.toFixed(4));
      root.style.setProperty('--sway', `${frame.sway.toFixed(3)}deg`);
      slots.forEach((slot, i) => {
        const s = frame.sheets[i];
        slot.style.setProperty('--up', s.up.toFixed(4));
        slot.style.setProperty('--gone', s.gone.toFixed(4));
        slot.style.setProperty('--past', s.past.toFixed(4));
        slot.style.setProperty('--fog', s.fog.toFixed(4));
      });

      if (frame.active !== shownActive) {
        shownActive = frame.active;
        rail.forEach((item, i) => {
          if (i === frame.active) item.setAttribute('data-on', 'true');
          else item.removeAttribute('data-on');
        });
      }
    };

    const schedule = () => {
      if (!frameId) frameId = window.requestAnimationFrame(paint);
    };

    const sync = () => {
      if (reduceMotion.matches) {
        root.dataset.flight = 'off';
        clearVars();
      } else {
        root.dataset.flight = 'on';
        schedule();
      }
    };

    sync();
    reduceMotion.addEventListener('change', sync);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);

    return () => {
      reduceMotion.removeEventListener('change', sync);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frameId) window.cancelAnimationFrame(frameId);
      delete root.dataset.flight;
      clearVars();
    };
  }, []);

  return (
    <section ref={rootRef} id="how-it-works" aria-labelledby="flight-heading" className="flight">
      <div className="flight-hero">{hero}</div>

      <div className="flight-stage">
        <h2 id="flight-heading" className="flight-heading">
          The daily loop, one sheet at a time
        </h2>

        <div className="flight-world">
          <div aria-hidden="true" className="flight-desk">
            {DESK_LINES.map((k) => (
              <span key={k} className="flight-rule" style={{ '--k': k } as CSSProperties} />
            ))}
          </div>
          <ol className="flight-sheets">{children}</ol>
        </div>

        <div aria-hidden="true" className="flight-glow" />
        <ol aria-hidden="true" className="flight-rail">
          {labels.map((label, i) => (
            <li key={label} data-rail>
              <span className="tabular">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
