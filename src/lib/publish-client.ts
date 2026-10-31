/**
 * Browser-side resumable uploader for YouTube videos. The file never leaves the browser except as small
 * chunks sent to PBOS's own API, which forwards them to YouTube (the access token stays on the server).
 *
 * Protocol with the server (see /api/publish/youtube/[jobId]/begin and /chunk):
 *   begin  -> { offset, chunkSize }     where to continue; chunkSize is a multiple of 256 KiB
 *   chunk  -> { done:false, nextOffset } or { done:true }
 *   409 + { expected } on a wrong offset: we resume from `expected`.
 * Pure and dependency-injected so it can be tested without a browser.
 */

export type UploadProgress = { sent: number; total: number; percent: number };

export type UploadOutcome =
  | { ok: true; videoUrl: string | null }
  | { ok: false; error: string; retryable: boolean };

type Fetch = typeof fetch;

export type UploadOptions = {
  jobId: string;
  file: Pick<Blob, 'size' | 'type' | 'slice'>;
  onProgress?: (p: UploadProgress) => void;
  signal?: AbortSignal;
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Network failures per chunk before giving up. */
  maxChunkAttempts?: number;
};

const pct = (sent: number, total: number) => Math.min(100, Math.floor((sent / total) * 100));

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function uploadYouTubeFile(opts: UploadOptions): Promise<UploadOutcome> {
  const doFetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const attemptsMax = opts.maxChunkAttempts ?? 5;
  const base = `/api/publish/youtube/${encodeURIComponent(opts.jobId)}`;
  const total = opts.file.size;

  let started: Response;
  try {
    started = await doFetch(`${base}/begin`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ size: total, mime: opts.file.type }), signal: opts.signal });
  } catch {
    return { ok: false, error: 'Could not reach PBOS. Check your connection and try again.', retryable: true };
  }
  const first = await readJson(started);
  if (!started.ok) return { ok: false, error: typeof first.error === 'string' ? first.error : 'The upload could not be started.', retryable: started.status >= 500 || started.status === 429 };
  if (first.done === true) {
    opts.onProgress?.({ sent: total, total, percent: 100 });
    return { ok: true, videoUrl: typeof first.url === 'string' ? first.url : null };
  }
  let offset = Number(first.offset ?? 0);
  const chunkSize = Number(first.chunkSize ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(chunkSize) || chunkSize < 262_144) return { ok: false, error: 'The server sent an unexpected upload plan.', retryable: false };

  let failures = 0;
  while (offset < total) {
    if (opts.signal?.aborted) return { ok: false, error: 'Upload paused. Choose the same file to resume.', retryable: true };
    const end = Math.min(offset + chunkSize, total);
    const body = opts.file.slice(offset, end);
    let res: Response;
    try {
      res = await doFetch(`${base}/chunk?offset=${offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body, signal: opts.signal });
    } catch {
      failures += 1;
      if (opts.signal?.aborted || failures >= attemptsMax) return { ok: false, error: 'The connection dropped. Choose the same file to resume where it stopped.', retryable: true };
      await sleep(Math.min(1000 * 2 ** failures, 15_000));
      continue;
    }
    const data = await readJson(res);
    if (res.status === 409 && typeof data.expected === 'number') {
      // Server and browser disagree about the position: trust the server.
      offset = data.expected;
      continue;
    }
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      if (retryable && ++failures < attemptsMax) { await sleep(Math.min(1000 * 2 ** failures, 15_000)); continue; }
      return { ok: false, error: typeof data.error === 'string' ? data.error : 'YouTube did not accept the upload.', retryable };
    }
    failures = 0;
    if (data.done === true) {
      opts.onProgress?.({ sent: total, total, percent: 100 });
      return { ok: true, videoUrl: typeof data.url === 'string' ? data.url : null };
    }
    offset = typeof data.nextOffset === 'number' ? data.nextOffset : end;
    opts.onProgress?.({ sent: offset, total, percent: pct(offset, total) });
  }
  return { ok: false, error: 'The upload ended before YouTube confirmed the video. Choose the same file to resume.', retryable: true };
}
