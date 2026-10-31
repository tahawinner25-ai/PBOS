import { activeOverlays, emptyProject, fitRect, locate, outputSize, TEXT_SCALE, timelineLength, type AspectKey, type ExportPlan, type Overlay, type Project } from './edl';

/**
 * The Studio's browser engine. It plays an edit on a canvas, and records it to a file in real time.
 *
 * Everything runs in the creator's own browser: the videos are decoded by the browser's <video> elements, each
 * frame is painted onto a canvas (picture, then text), and export records that canvas and the mixed audio with
 * MediaRecorder. Nothing is sent to a server until the creator chooses to save the result to their library.
 *
 * Honest limits of this approach (they are shown to the creator, not hidden):
 *  - export runs at normal speed, so a 60 second edit takes about 60 seconds, and the tab must stay open;
 *  - the output format is whatever the browser's MediaRecorder offers: MP4 on current Chrome, Edge and Safari,
 *    WebM on Firefox. Only MP4 can be added to the PBOS library, because that is what Instagram needs.
 */

export const TEXT_COLORS = { white: '#ffffff', yellow: '#ffe14d', black: '#000000' } as const;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** Preview is drawn at half the 720p output size: sharp enough to judge an edit, light enough to stay smooth. */
export function previewSize(aspect: AspectKey): { width: number; height: number } {
  const o = outputSize(aspect, '720p');
  return { width: Math.round(o.width / 2), height: Math.round(o.height / 2) };
}

/* ── drawing ───────────────────────────────────────────────────────────── */

/** Breaks text into lines no wider than maxWidth. Words longer than a line are split. Pure: `measure` is injected. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (measure(w) > maxWidth && w.length > 1) {
        let cut = w.length - 1;
        while (cut > 1 && measure(w.slice(0, cut)) > maxWidth) cut -= 1;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      const tryLine = line ? `${line} ${w}` : w;
      if (measure(tryLine) <= maxWidth || !line) line = tryLine;
      else { lines.push(line); line = w; }
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, o: Overlay) {
  const px = Math.max(10, Math.round(TEXT_SCALE[o.size] * Math.min(w, h)));
  ctx.save();
  ctx.font = `700 ${px}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const lines = wrapText(o.text, w * 0.84, (s) => ctx.measureText(s).width);
  const lineH = Math.round(px * 1.25);
  const blockH = lines.length * lineH;
  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 1);
  // Vertical frames keep text clear of the buttons that platforms draw along the bottom edge.
  const margin = h > w ? 0.16 : 0.08;
  const top = o.position === 'top' ? h * 0.08 : o.position === 'middle' ? (h - blockH) / 2 : h - h * margin - blockH;
  const pad = px * 0.45;
  if (o.box) {
    ctx.fillStyle = o.color === 'black' ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.62)';
    roundRect(ctx, w / 2 - widest / 2 - pad, top - pad * 0.6, widest + pad * 2, blockH + pad * 1.2, px * 0.3);
    ctx.fill();
  } else {
    ctx.shadowColor = o.color === 'black' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = px * 0.18;
  }
  ctx.fillStyle = TEXT_COLORS[o.color];
  lines.forEach((l, i) => ctx.fillText(l, w / 2, top + i * lineH));
  ctx.restore();
}

export type Picture = { source: CanvasImageSource; width: number; height: number };

/** One finished frame: black background, the picture fitted to the frame, then every text layer showing at time t. */
export function drawFrame(ctx: CanvasRenderingContext2D, w: number, h: number, project: Project, t: number, picture: Picture | null) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  if (picture) {
    const r = fitRect(picture.width, picture.height, w, h, project.fit);
    ctx.drawImage(picture.source, r.x, r.y, r.w, r.h);
  }
  for (const o of activeOverlays(project, t)) drawOverlay(ctx, w, h, o);
}

/* ── export format ─────────────────────────────────────────────────────── */

export type ExportFormat = {
  mimeType: string;
  extension: 'mp4' | 'webm';
  /** True only when the file is H.264 video with AAC audio, which is what Instagram accepts. */
  instagramSafe: boolean;
};

const MIME_CANDIDATES: ExportFormat[] = [
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', instagramSafe: true },
  { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', extension: 'mp4', instagramSafe: true },
  // A bare MP4 container: the browser picks the codecs, and some builds pick VP9 and Opus, which Instagram rejects.
  { mimeType: 'video/mp4', extension: 'mp4', instagramSafe: false },
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', instagramSafe: false },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', instagramSafe: false },
  { mimeType: 'video/webm', extension: 'webm', instagramSafe: false },
];

/** The best format this browser can record, or null if it cannot record video at all. H.264 MP4 is preferred. */
export function pickExportFormat(isSupported: (mime: string) => boolean = (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)): ExportFormat | null {
  return MIME_CANDIDATES.find((c) => isSupported(c.mimeType)) ?? null;
}

/* ── loading a source ──────────────────────────────────────────────────── */

export type SourceInfo = { duration: number; width: number; height: number };

/** Reads a video's length and size from its metadata. Rejects if the browser cannot decode it. */
export function probeVideo(url: string, timeoutMs = 15_000): Promise<SourceInfo> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const done = (fn: () => void) => { clearTimeout(timer); v.removeAttribute('src'); v.load(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error('Reading the video took too long.'))), timeoutMs);
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      const info = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      done(() => (Number.isFinite(info.duration) && info.duration > 0 && info.width > 0 ? resolve(info) : reject(new Error('This video has no readable length or picture.'))));
    };
    v.onerror = () => done(() => reject(new Error('This browser cannot play that video. Try an MP4 (H.264) file.')));
    v.src = url;
  });
}

/* ── the engine ────────────────────────────────────────────────────────── */

const SEEK_TIMEOUT = 2500;
const LOOKAHEAD = 0.8;

function seekTo(v: HTMLVideoElement, time: number): Promise<void> {
  if (v.readyState >= 1 && Math.abs(v.currentTime - time) < 0.02) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); v.removeEventListener('seeked', finish); resolve(); };
    const timer = setTimeout(finish, SEEK_TIMEOUT);
    v.addEventListener('seeked', finish);
    try { v.currentTime = time; } catch { finish(); }
  });
}

type AudioParts = { src: MediaElementAudioSourceNode; gain: GainNode };

export class StudioEngine {
  onTime: (t: number) => void = () => {};
  onEnded: () => void = () => {};
  onError: (message: string) => void = () => {};

  private project: Project = emptyProject();
  private urls: Record<string, string> = {};
  private videos = new Map<string, HTMLVideoElement>();
  private audioParts = new Map<string, AudioParts>();
  private audio: AudioContext | null = null;
  private speakers: GainNode | null = null;
  private recordDest: MediaStreamAudioDestinationNode | null = null;
  private ctx2d: CanvasRenderingContext2D;
  private t = 0;
  private playing = false;
  private raf = 0;
  private last = 0;
  private active = -1;
  private preparedNext = -1;
  private paintToken = 0;
  private exporting = false;

  constructor(private canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('This browser cannot draw video.');
    this.ctx2d = c;
    this.setSize(previewSize(this.project.aspect));
  }

  get time() { return this.t; }
  get isPlaying() { return this.playing; }

  /** Gives the engine the latest edit and where each source video lives (a blob: URL). Cheap to call after every change. */
  setProject(project: Project, urls: Record<string, string>) {
    this.project = project;
    this.urls = urls;
    const keep = new Set(project.clips.map((c) => c.id));
    for (const [id, v] of this.videos) if (!keep.has(id)) this.dropVideo(id, v);
    for (const c of project.clips) {
      const url = urls[c.sourceId];
      if (!url) continue;
      let v = this.videos.get(c.id);
      if (!v) { v = this.makeVideo(url); this.videos.set(c.id, v); void seekTo(v, c.start); }
      const parts = this.audioParts.get(c.id);
      if (parts) parts.gain.gain.value = c.volume;
    }
    if (!this.exporting) this.setSize(previewSize(project.aspect));
    this.t = Math.min(this.t, timelineLength(project));
    this.active = -1;
    this.preparedNext = -1;
    if (!this.playing) void this.paint(this.t);
  }

  /** Move the playhead. Pauses playback. */
  async seek(t: number) {
    this.pause();
    this.t = Math.min(Math.max(0, t), timelineLength(this.project));
    this.onTime(this.t);
    await this.paint(this.t);
  }

  async play() {
    if (this.playing || this.project.clips.length === 0) return;
    const total = timelineLength(this.project);
    if (this.t >= total - 0.05) this.t = 0;
    this.ensureAudio();
    try { await this.audio?.resume(); } catch { /* the creator's click is what allows sound; without it playback is silent */ }
    this.playing = true;
    this.active = -1;
    this.preparedNext = -1;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const v of this.videos.values()) v.pause();
  }

  destroy() {
    this.pause();
    for (const [id, v] of this.videos) this.dropVideo(id, v);
    void this.audio?.close();
    this.audio = null;
  }

  /** Records the whole edit at normal speed. Resolves with the file, rejects with Error('cancelled') if aborted. */
  async exportVideo(plan: ExportPlan, format: ExportFormat, opts: { onProgress: (fraction: number) => void; signal: AbortSignal }): Promise<{ blob: Blob; extension: 'mp4' | 'webm'; seconds: number }> {
    if (this.exporting) throw new Error('An export is already running.');
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video.');
    this.exporting = true;
    this.pause();
    this.ensureAudio();
    try { await this.audio?.resume(); } catch { /* handled below: a silent export is still a valid export */ }
    if (this.speakers) this.speakers.gain.value = 0;
    this.setSize({ width: plan.width, height: plan.height });
    this.t = 0;
    this.active = -1;
    this.preparedNext = -1;
    await this.paint(0);

    const stream = this.canvas.captureStream(plan.fps);
    this.recordDest?.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: plan.videoBitsPerSecond, audioBitsPerSecond: plan.audioBitsPerSecond });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const restore = () => {
      this.pause();
      // Stop the picture, but only detach the sound: the audio track belongs to the engine and the next export needs it.
      stream.getVideoTracks().forEach((track) => track.stop());
      this.recordDest?.stream.getAudioTracks().forEach((track) => stream.removeTrack(track));
      if (this.speakers) this.speakers.gain.value = 1;
      this.exporting = false;
      this.setSize(previewSize(this.project.aspect));
      this.t = 0;
      void this.paint(0);
    };

    return new Promise((resolve, reject) => {
      let finished = false;
      const abort = () => { if (finished) return; finished = true; try { recorder.stop(); } catch { /* already stopped */ } restore(); reject(new Error('cancelled')); };
      if (opts.signal.aborted) return abort();
      opts.signal.addEventListener('abort', abort, { once: true });
      const total = timelineLength(this.project);
      const prevTime = this.onTime;
      const prevEnded = this.onEnded;
      const detach = () => { this.onTime = prevTime; this.onEnded = prevEnded; opts.signal.removeEventListener('abort', abort); };
      this.onTime = (t) => { opts.onProgress(Math.min(1, t / total)); };
      this.onEnded = () => {
        if (finished) return;
        finished = true;
        detach();
        // Let the last frame and the audio tail reach the recorder before it is closed.
        setTimeout(() => {
          try { recorder.stop(); } catch { /* already stopped */ }
          void stopped.then(() => {
            restore();
            const blob = new Blob(chunks, { type: format.mimeType.split(';')[0] });
            if (blob.size === 0) reject(new Error('The browser produced an empty file. Try again, or use a different browser.'));
            else resolve({ blob, extension: format.extension, seconds: total });
          });
        }, 400);
      };
      recorder.onerror = () => { if (finished) return; finished = true; detach(); restore(); reject(new Error('The browser could not record this edit.')); };
      recorder.start(500);
      void this.play();
    });
  }

  /* ── internals ── */

  private setSize({ width, height }: { width: number; height: number }) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private makeVideo(url: string): HTMLVideoElement {
    const v = document.createElement('video');
    v.preload = 'auto';
    v.playsInline = true;
    v.src = url;
    v.addEventListener('error', () => this.onError('One of the videos could not be played by this browser.'));
    return v;
  }

  private dropVideo(id: string, v: HTMLVideoElement) {
    v.pause();
    this.audioParts.get(id)?.src.disconnect();
    this.audioParts.get(id)?.gain.disconnect();
    this.audioParts.delete(id);
    v.removeAttribute('src');
    v.load();
    this.videos.delete(id);
  }

  /** Builds the audio graph once: every clip's sound goes through its own volume to the speakers and to the recorder. */
  private ensureAudio() {
    if (!this.audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.audio = new Ctor();
      this.speakers = this.audio.createGain();
      this.speakers.connect(this.audio.destination);
      this.recordDest = this.audio.createMediaStreamDestination();
    }
    const audio = this.audio;
    for (const clip of this.project.clips) {
      const v = this.videos.get(clip.id);
      if (!v || this.audioParts.has(clip.id)) continue;
      try {
        const src = audio.createMediaElementSource(v);
        const gain = audio.createGain();
        gain.gain.value = clip.volume;
        src.connect(gain);
        if (this.speakers) gain.connect(this.speakers);
        if (this.recordDest) gain.connect(this.recordDest);
        this.audioParts.set(clip.id, { src, gain });
      } catch { /* an element can only be wired once; if it fails the clip plays unmixed */ }
    }
  }

  /** Draws timeline time t while paused: seek the right video to the right moment, then paint. Newer calls win. */
  private async paint(t: number) {
    const token = ++this.paintToken;
    const loc = locate(this.project, t);
    if (!loc) { drawFrame(this.ctx2d, this.canvas.width, this.canvas.height, this.project, t, null); return; }
    const v = this.videos.get(loc.clip.id);
    if (!v) { drawFrame(this.ctx2d, this.canvas.width, this.canvas.height, this.project, t, null); return; }
    await seekTo(v, loc.sourceTime);
    if (token !== this.paintToken) return;
    drawFrame(this.ctx2d, this.canvas.width, this.canvas.height, this.project, t, { source: v, width: v.videoWidth, height: v.videoHeight });
  }

  private tick = () => {
    if (!this.playing) return;
    const now = performance.now();
    this.t += (now - this.last) / 1000;
    this.last = now;
    const total = timelineLength(this.project);
    if (this.t >= total) { this.finish(total); return; }

    const loc = locate(this.project, this.t);
    if (loc) {
      const v = this.videos.get(loc.clip.id);
      if (v) {
        if (loc.index !== this.active) this.enter(loc.index, loc.sourceTime);
        else if (Math.abs(v.currentTime - loc.sourceTime) > 0.35) v.currentTime = loc.sourceTime;
        this.lookAhead(loc.index, loc.clip.end - loc.sourceTime);
        if (v.readyState >= 2) drawFrame(this.ctx2d, this.canvas.width, this.canvas.height, this.project, this.t, { source: v, width: v.videoWidth, height: v.videoHeight });
      }
    }
    this.onTime(this.t);
    this.raf = requestAnimationFrame(this.tick);
  };

  /** Start playing clip `index` from sourceTime and stop the one before it. */
  private enter(index: number, sourceTime: number) {
    const clips = this.project.clips;
    for (const [id, v] of this.videos) if (id !== clips[index].id) v.pause();
    const v = this.videos.get(clips[index].id);
    this.active = index;
    if (!v) return;
    if (this.preparedNext !== index) v.currentTime = sourceTime;
    v.playbackRate = 1;
    void v.play().catch(() => this.onError('The browser blocked playback. Press Play again.'));
  }

  /** Shortly before a clip ends, get the next one waiting at its first frame so the cut is instant. */
  private lookAhead(index: number, remaining: number) {
    const next = this.project.clips[index + 1];
    if (!next || remaining > LOOKAHEAD || this.preparedNext === index + 1) return;
    const v = this.videos.get(next.id);
    if (!v) return;
    this.preparedNext = index + 1;
    v.pause();
    void seekTo(v, next.start);
  }

  private finish(total: number) {
    this.playing = false;
    for (const v of this.videos.values()) v.pause();
    this.t = total;
    const last = locate(this.project, Math.max(0, total - 0.001));
    const v = last ? this.videos.get(last.clip.id) : undefined;
    if (v && v.readyState >= 2) drawFrame(this.ctx2d, this.canvas.width, this.canvas.height, this.project, Math.max(0, total - 0.001), { source: v, width: v.videoWidth, height: v.videoHeight });
    this.onTime(total);
    this.onEnded();
  }
}
