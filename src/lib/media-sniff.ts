/**
 * Identifies a media file from its first bytes. The browser's Content-Type and the file name are
 * claims made by the sender; the bytes are the evidence. Used before a stored upload is accepted into
 * the creator's library, so a renamed script or an executable cannot sit there as "photo.jpg".
 */

export type SniffedType = { kind: 'image' | 'video'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/quicktime' };

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));

export function sniffMedia(bytes: Uint8Array): SniffedType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png' };
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (ascii(bytes, 4, 'ftyp')) {
    // ISO base media: the major brand tells QuickTime (.mov) from MP4.
    return ascii(bytes, 8, 'qt  ') ? { kind: 'video', mime: 'video/quicktime' } : { kind: 'video', mime: 'video/mp4' };
  }
  return null;
}

export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const ALLOWED_UPLOAD_MIME = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime'] as const;
export const EXTENSION: Record<(typeof ALLOWED_UPLOAD_MIME)[number], string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/quicktime': 'mov',
};
