import { ImageResponse } from 'next/og';

export const alt = 'PBOS: Personal Brand Operating System';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Default share card for the site. Generated from text and shapes only. */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 80px',
          background: '#101223',
          color: '#F1EEE6',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none">
            <rect x="3" y="3" width="18" height="18" rx="4" stroke="#E0B567" strokeWidth="1.6" />
            <path d="M8 16V8m4 8v-5m4 5v-8" stroke="#E0B567" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <div style={{ fontSize: 44, fontWeight: 600 }}>PBOS</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 76, lineHeight: 1.08, maxWidth: 940 }}>The operating system for one creator.</div>
          <div style={{ fontSize: 32, color: '#B4B8CC', maxWidth: 900 }}>
            Scan your records, see what needs attention, approve the draft.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
