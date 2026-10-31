/**
 * PUTs a file to a one-time signed storage URL and reports progress (0 to 100). Resolves true on success.
 * The body has the same shape the Supabase client sends: a multipart form with the file as the unnamed part.
 */
export function putWithProgress(url: string, file: Blob, onProgress: (pct: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress((e.loaded / e.total) * 100); };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    const body = new FormData();
    body.append('cacheControl', '3600');
    body.append('', file);
    xhr.send(body);
  });
}
