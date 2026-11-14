import { ASPECTS, LIMITS, TEXT_SCALE, outputSize, type AspectKey, type FitMode, type Overlay } from './edl';

/**
 * Builds the ffmpeg command for an edit made on the server (the agent's render_edit). Pure: it returns the arguments and
 * the caption texts to write to files, and never runs anything. Mirrors the Studio's own rules: clips laid end to end,
 * cover or contain fit, captions with an optional box, the same text sizes.
 *
 * Captions go through `textfile=` (not inline text) so nothing the creator or the model wrote can be read as filter syntax.
 */

export const RENDER_LIMITS = {
  /** An edit made on the server is capped lower than the Studio's browser export so it finishes inside the function time limit. */
  maxSeconds: 120,
  maxSources: 8,
  /** Total bytes of source files downloaded to the function's temporary disk. */
  maxSourceBytes: 300 * 1024 * 1024,
  fps: 30,
  audioBitrate: 128_000,
} as const;

export type RenderClip = { input: number; start: number; end: number; volume: number };
export type RenderText = { text: string; start: number; end: number; position: Overlay['position']; size: Overlay['size']; color: Overlay['color']; box: boolean };
export type RenderSpec = {
  aspect: AspectKey;
  fit: FitMode;
  /** One entry per downloaded source, in input order: true when the file has an audio track. */
  sourceHasAudio: boolean[];
  clips: RenderClip[];
  texts: RenderText[];
};

export type RenderCommand = { args: string[]; textFiles: Array<{ name: string; content: string }>; seconds: number; width: number; height: number; videoBitrate: number };

const num = (n: number) => String(Math.round(n * 1000) / 1000);

/** Breaks a caption into lines that fit the frame (drawtext does not wrap). */
export function wrapCaption(text: string, px: number, width: number): string {
  const perLine = Math.max(8, Math.floor((width * 0.86) / (px * 0.58)));
  const out: string[] = [];
  for (const para of text.replace(/\r/g, '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (next.length > perLine && line) { out.push(line); line = word; } else line = next;
    }
    out.push(line);
  }
  return out.join('\n');
}

const TEXT_COLOR: Record<Overlay['color'], string> = { white: 'white', yellow: 'yellow', black: 'black' };

export function buildRender(spec: RenderSpec, fontPath: string, textDir: string): RenderCommand | { error: string } {
  if (!spec.clips.length) return { error: 'There are no clips to render.' };
  const seconds = Math.round(spec.clips.reduce((n, c) => n + (c.end - c.start), 0) * 1000) / 1000;
  if (seconds > RENDER_LIMITS.maxSeconds) return { error: `A server edit can be at most ${RENDER_LIMITS.maxSeconds} seconds. This one is ${seconds}.` };
  if (seconds > LIMITS.maxLibrarySeconds) return { error: 'The edit is too long for the library.' };
  const { width, height } = outputSize(spec.aspect, '720p');
  if (!ASPECTS[spec.aspect]) return { error: 'Unknown aspect.' };

  const f: string[] = [];
  // An input stream can feed only one filter, so a source used by several clips is split first.
  const uses = spec.sourceHasAudio.map((_, i) => spec.clips.filter((c) => c.input === i).length);
  if (uses.some((k) => k === 0)) return { error: 'Every source must be used by at least one clip.' };
  const vLabel: string[] = [];
  const aLabel: string[] = [];
  const seen = new Array<number>(uses.length).fill(0);
  uses.forEach((k, i) => {
    if (k > 1) {
      f.push(`[${i}:v]split=${k}${Array.from({ length: k }, (_, n) => `[sv${i}_${n}]`).join('')}`);
      if (spec.sourceHasAudio[i]) f.push(`[${i}:a]asplit=${k}${Array.from({ length: k }, (_, n) => `[sa${i}_${n}]`).join('')}`);
    }
  });
  spec.clips.forEach((c, i) => {
    const n = seen[c.input]++;
    vLabel[i] = uses[c.input] > 1 ? `sv${c.input}_${n}` : `${c.input}:v`;
    aLabel[i] = uses[c.input] > 1 ? `sa${c.input}_${n}` : `${c.input}:a`;
  });
  spec.clips.forEach((c, i) => {
    const d = c.end - c.start;
    const scale = spec.fit === 'cover'
      ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
      : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`;
    f.push(`[${vLabel[i]}]trim=start=${num(c.start)}:end=${num(c.end)},setpts=PTS-STARTPTS,${scale},setsar=1,fps=${RENDER_LIMITS.fps},format=yuv420p[v${i}]`);
    if (spec.sourceHasAudio[c.input]) {
      f.push(`[${aLabel[i]}]atrim=start=${num(c.start)}:end=${num(c.end)},asetpts=PTS-STARTPTS,volume=${num(c.volume)},aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
    } else {
      f.push(`anullsrc=r=44100:cl=stereo,atrim=duration=${num(d)},asetpts=PTS-STARTPTS[a${i}]`);
    }
  });
  f.push(`${spec.clips.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${spec.clips.length}:v=1:a=1[vc][a]`);

  const textFiles: RenderCommand['textFiles'] = [];
  let last = 'vc';
  spec.texts.forEach((t, i) => {
    const px = Math.round(TEXT_SCALE[t.size] * Math.min(width, height));
    const name = `caption${i}.txt`;
    textFiles.push({ name, content: wrapCaption(t.text, px, width) });
    const y = t.position === 'top' ? `h*0.08` : t.position === 'middle' ? '(h-text_h)/2' : 'h-text_h-h*0.08';
    const box = t.box ? `:box=1:boxcolor=${t.color === 'black' ? 'white@0.7' : 'black@0.6'}:boxborderw=${Math.round(px / 3)}` : '';
    const out = i === spec.texts.length - 1 ? 'v' : `vt${i}`;
    f.push(`[${last}]drawtext=fontfile=${fontPath}:textfile=${textDir}/${name}:fontsize=${px}:fontcolor=${TEXT_COLOR[t.color]}:x=(w-text_w)/2:y=${y}:line_spacing=${Math.round(px / 5)}${box}:enable='between(t,${num(t.start)},${num(t.end)})'[${out}]`);
    last = out;
  });
  if (!spec.texts.length) f.push(`[vc]null[v]`);

  // The file must fit the library's cap: lower the bitrate for longer edits.
  const budgetBits = LIMITS.libraryBytes * 0.85 * 8;
  const videoBitrate = Math.max(600_000, Math.min(4_000_000, Math.floor(budgetBits / seconds - RENDER_LIMITS.audioBitrate)));
  return {
    args: [
      '-hide_banner', '-nostdin', '-y',
      ...spec.sourceHasAudio.flatMap((_, i) => ['-i', `__INPUT_${i}__`]),
      '-filter_complex', f.join(';'),
      '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-b:v', String(videoBitrate), '-maxrate', String(videoBitrate), '-bufsize', String(videoBitrate * 2),
      '-c:a', 'aac', '-b:a', String(RENDER_LIMITS.audioBitrate),
      '-movflags', '+faststart', '-t', num(seconds), '-f', 'mp4', '__OUTPUT__',
    ],
    textFiles, seconds, width, height, videoBitrate,
  };
}
