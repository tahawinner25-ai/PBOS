import 'server-only';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { LIMITS } from '@/lib/studio/edl';
import { RENDER_LIMITS, buildRender, type RenderSpec } from '@/lib/studio/ffmpeg-args';

/**
 * Runs ffmpeg for the agent's render_edit. One render at a time per server instance (the free plan's memory is small),
 * a hard time limit, and the temporary folder is always removed. Sources are downloaded from short-lived signed URLs.
 */

export type RenderSource = { url: string; bytes: number | null };
export type RenderResult = { ok: true; bytes: Uint8Array; seconds: number; width: number; height: number } | { ok: false; error: string };

let busy = false;
const TIME_LIMIT_MS = 200_000;
const FONT = () => path.join(process.cwd(), 'src', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

function run(bin: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    child.stderr.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stderr: 'ffmpeg could not start', timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stderr, timedOut }); });
  });
}

export async function renderEdit(spec: Omit<RenderSpec, 'sourceHasAudio'>, sources: RenderSource[]): Promise<RenderResult> {
  if (!ffmpegPath) return { ok: false, error: 'Video rendering is not available on this deployment.' };
  if (sources.length === 0 || sources.length > RENDER_LIMITS.maxSources) return { ok: false, error: `An edit can use 1 to ${RENDER_LIMITS.maxSources} different videos.` };
  const declared = sources.reduce((n, s) => n + (s.bytes ?? 0), 0);
  if (declared > RENDER_LIMITS.maxSourceBytes) return { ok: false, error: 'The source videos are too large to edit together here.' };
  if (busy) return { ok: false, error: 'Another video is being rendered right now. Try again in a minute.' };
  busy = true;
  const dir = await mkdtemp(path.join(tmpdir(), 'pbos-render-'));
  try {
    const files: string[] = [];
    let total = 0;
    for (const [i, s] of sources.entries()) {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return { ok: false, error: 'A source video could not be read from your library.' };
      const buf = new Uint8Array(await res.arrayBuffer());
      total += buf.byteLength;
      if (buf.byteLength === 0 || total > RENDER_LIMITS.maxSourceBytes) return { ok: false, error: 'A source video is empty or the videos are too large together.' };
      const file = path.join(dir, `in${i}`);
      await writeFile(file, buf);
      files.push(file);
    }
    // ffmpeg-static ships no ffprobe: ask ffmpeg itself whether each file has sound.
    const sourceHasAudio: boolean[] = [];
    for (const f of files) {
      const probe = await run(ffmpegPath, ['-hide_banner', '-i', f], 30_000);
      if (probe.timedOut) return { ok: false, error: 'A source video could not be inspected in time.' };
      if (!/Video:/.test(probe.stderr)) return { ok: false, error: 'One of the files is not a readable video.' };
      sourceHasAudio.push(/Audio:/.test(probe.stderr));
    }
    const built = buildRender({ ...spec, sourceHasAudio }, FONT(), dir);
    if ('error' in built) return { ok: false, error: built.error };
    for (const t of built.textFiles) await writeFile(path.join(dir, t.name), t.content);
    const out = path.join(dir, 'out.mp4');
    const args = built.args.map((a) => (a === '__OUTPUT__' ? out : a.replace(/^__INPUT_(\d+)__$/, (_m, n: string) => files[Number(n)])));
    const r = await run(ffmpegPath, args, TIME_LIMIT_MS);
    if (r.timedOut) return { ok: false, error: 'The render took too long and was stopped. Try a shorter edit.' };
    if (r.code !== 0) { console.error('[render] ffmpeg failed', r.code); return { ok: false, error: 'The video could not be rendered. Nothing was saved.' }; }
    const size = (await stat(out)).size;
    if (size <= 0 || size > LIMITS.libraryBytes) return { ok: false, error: 'The finished video is larger than the library allows. Try a shorter edit.' };
    return { ok: true, bytes: new Uint8Array(await readFile(out)), seconds: built.seconds, width: built.width, height: built.height };
  } catch (e) {
    console.error('[render] failed', e instanceof Error ? e.name : 'error');
    return { ok: false, error: 'The video could not be rendered. Nothing was saved.' };
  } finally {
    busy = false;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
