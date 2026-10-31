import type { CSSProperties, ReactNode } from 'react';

/**
 * The five sheets of the landing page "flight", one per step of the daily loop.
 * Every name and sentence on a sheet that stands in for user data is an invented example and says so.
 */

/** Horizontal placement of each sheet on the desk, in units of the --shift length (negative is left). */
const SIDES = [-1, 1, -1, 1, 0] as const;
/** A slight, fixed tilt per sheet so they read as placed by hand. */
const TILTS = [-1.6, 1.2, -0.8, 1.5, -0.4] as const;

function Slot({ index, name, children }: { index: number; name: string; children: ReactNode }) {
  const style = { '--i': index, '--side': SIDES[index] ?? 0, '--tilt': `${TILTS[index] ?? 0}deg` } as CSSProperties;
  return (
    <li data-slot className="flight-slot" style={style}>
      <article aria-labelledby={`sheet-${index}`} className="paper-sheet flight-sheet">
        <header className="sheet-head">
          <h3 id={`sheet-${index}`} className="sheet-title">
            <span aria-hidden="true" className="tabular sheet-step">
              {index + 1}
            </span>
            {name}
          </h3>
        </header>
        {children}
      </article>
    </li>
  );
}

function Example() {
  return <p className="sheet-note">Invented example, not real data.</p>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sheet-field">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function LandingSheets() {
  return (
    <>
      <Slot index={0} name="Scan">
        <p className="sheet-lede">Four plain rules run on your own records before any AI is involved.</p>
        <dl className="sheet-rules">
          <Field label="Ideas">An idea has waited more than a week.</Field>
          <Field label="Posts">A post has no results logged.</Field>
          <Field label="Deals">A deal has sat in one stage for a week.</Field>
          <Field label="Revenue">An invoice is past its due date.</Field>
        </dl>
        <p className="sheet-note">Nothing is read from social platforms. You enter what you want checked.</p>
      </Slot>

      <Slot index={1} name="Flag">
        <p className="sheet-lede">Each finding points to the records behind it, so you can check it in one click.</p>
        <dl className="sheet-rules">
          <Field label="Deals">[Brand name] has been in Negotiating for more than 7 days.</Field>
          <Field label="Posts">“[Post title]” has no results logged.</Field>
        </dl>
        <Example />
      </Slot>

      <Slot index={2} name="Suggest">
        <p className="sheet-lede">Up to three next actions. Each says why, and which record it came from.</p>
        <dl className="sheet-rules">
          <Field label="Action">
            <span className="sheet-strong">Send a follow-up to [Brand name].</span>
          </Field>
          <Field label="Why">The stage has not changed in over a week and no close date is set.</Field>
          <Field label="Source">Deal: [Brand name], Negotiating</Field>
        </dl>
        <div aria-hidden="true" className="sheet-actions">
          <span className="sheet-button sheet-button-primary">Accept</span>
          <span className="sheet-button">Ignore</span>
        </div>
        <Example />
      </Slot>

      <Slot index={3} name="Draft">
        <p className="sheet-lede">The most valuable action gets a draft. You edit it and send it yourself.</p>
        <div className="paper-body sheet-draft">
          {'Subject: Checking in on our collaboration\n\nHi [Name],\n\nI wanted to follow up on the open points from our last conversation and agree a next step.\n\n[Your name]'}
        </div>
        <p className="sheet-note">Draft only. PBOS never sends email.</p>
        <Example />
      </Slot>

      <Slot index={4} name="Learn">
        <p className="sheet-lede">Accept or ignore every suggestion. PBOS adjusts to what you do.</p>
        <dl className="sheet-rules">
          <Field label="Ignored twice">Paused for 14 days. The flag stays visible.</Field>
          <Field label="Accepted">Given two days, then raised again only if the data has not changed.</Field>
          <Field label="Pattern">Areas you act on rank a little higher.</Field>
        </dl>
        <p className="sheet-note">Whenever PBOS pauses or re-ranks something, it says so on your dashboard.</p>
      </Slot>
    </>
  );
}
