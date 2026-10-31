import { ImageResponse } from 'next/og';
import { loadPublicKit } from '@/lib/server/public';

export const runtime = 'nodejs';
export const revalidate = 300;
export const alt = 'Work with this creator';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Share card for the public media kit, built only from the published name, niche and positioning. */
export default async function MediaKitOpenGraphImage() {
  const kit = await loadPublicKit();
  const name = kit.state === 'ok' ? kit.profile.name : 'Work with me';
  const line = kit.state === 'ok' ? (kit.profile.positioning ?? kit.profile.niche ?? '') : '';
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
          background: '#F5F2EA',
          color: '#1B1D33',
        }}
      >
        <div style={{ fontSize: 34, color: '#555873' }}>Media kit</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ fontSize: 92, lineHeight: 1.05, fontWeight: 600 }}>{name}</div>
          {line ? <div style={{ fontSize: 38, color: '#3A3D5C', maxWidth: 980 }}>{line}</div> : null}
        </div>
        <div style={{ fontSize: 30, color: '#555873' }}>Collaboration options, rates and contact</div>
      </div>
    ),
    size,
  );
}
