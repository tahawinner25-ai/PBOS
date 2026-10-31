const log = (c: any) => { (window as any).__calls = [...((window as any).__calls ?? []), c]; };
export async function requestMediaUpload(i: { mime: string; bytes: number }) { log({ fn: 'requestMediaUpload', ...i }); return { ok: true, data: { uploadUrl: '/upload', path: 'user/abc.mp4' } }; }
export async function registerMedia(i: any) { log({ fn: 'registerMedia', ...i }); return { ok: true, data: { id: 'new' } }; }
