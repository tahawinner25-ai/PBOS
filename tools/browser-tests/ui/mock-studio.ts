export async function signedVideoUrl(id: string) {
  (window as any).__calls = [...((window as any).__calls ?? []), { fn: 'signedVideoUrl', id }];
  return { ok: true, data: { url: '/a.webm', label: 'Library clip', bytes: 1000 } };
}
