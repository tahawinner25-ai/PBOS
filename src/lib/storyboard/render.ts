import { drawOverlay, pickExportFormat, type ExportFormat } from '../studio/engine';
import { outputSize, type AspectKey, type Overlay } from '../studio/edl';
import { DEFAULT_SOUND, SoundEngine, hasSound, type SoundSettings } from './audio';
import { layersAt, sceneRect, totalSeconds, type Scene } from './plan';

/**
 * Draws a storyboard to a canvas and records it to a file, all in the creator's own browser. Pictures are painted
 * with a slow camera move, scenes cross-fade into each other, and each scene's caption sits on top.
 *
 * Sound (a built-in background track and/or an audio file the creator brings) is mixed into the recording when chosen.
 *
 * Honest limits, shown to the creator: the recording runs at normal speed (a 30 second video takes 30 seconds), and the
 * tab has to stay open and in front.
 */

export type ScenePicture = { source: CanvasImageSource; width: number; height: number };

const CAPTION: Pick<Overlay, 'position' | 'size' | 'color' | 'box'> = { position: 'bottom', size: 'medium', color: 'white', box: true };

/** One finished frame at time t. A scene whose picture is missing is drawn as a plain dark frame. */
export function drawStoryboardFrame(ctx: CanvasRenderingContext2D, w: number, h: number, scenes: Scene[], pictures: Map<string, ScenePicture>, t: number) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#05060f';
  ctx.fillRect(0, 0, w, h);
  for (const layer of layersAt(scenes, t)) {
    const scene = scenes[layer.index];
    const pic = pictures.get(scene.id);
    ctx.globalAlpha = layer.alpha;
    if (pic) {
      const r = sceneRect(pic.width, pic.height, w, h, scene.motion, layer.progress);
      ctx.drawImage(pic.source, r.x, r.y, r.w, r.h);
    }
    if (scene.caption.trim()) {
      // Captions ease in a little after the picture so the cross-fade stays clean.
      const into = layer.progress * scene.seconds;
      ctx.globalAlpha = layer.alpha * Math.min(1, into / 0.3);
      drawOverlay(ctx, w, h, { id: scene.id, text: scene.caption, start: 0, end: scene.seconds, ...CAPTION });
    }
  }
  ctx.globalAlpha = 1;
}

export const previewDimensions = (shape: AspectKey) => {
  const o = outputSize(shape, '720p');
  return { width: Math.round(o.width / 2), height: Math.round(o.height / 2) };
};

export type StoryboardExport = { blob: Blob; extension: ExportFormat['extension']; seconds: number; width: number; height: number; instagramSafe: boolean; hasSound: boolean };

/** About 3.5 Mbit/s keeps a full 60 second video near 26 MB, under the library's 50 MB cap. */
export const EXPORT_BITRATE = 3_500_000;
export const estimatedBytes = (seconds: number) => Math.round((EXPORT_BITRATE * seconds) / 8);

export class StoryboardPlayer {
  onTime: (t: number) => void = () => {};
  onEnded: () => void = () => {};

  private ctx: CanvasRenderingContext2D;
  private scenes: Scene[] = [];
  private pictures = new Map<string, ScenePicture>();
  private shape: AspectKey = '9:16';
  private t = 0;
  private playing = false;
  private exporting = false;
  private raf = 0;
  private last = 0;
  private sound = new SoundEngine();
  private soundSettings: SoundSettings = DEFAULT_SOUND;
  private ownAudio: AudioBuffer | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const c = canvas.getContext('2d', { alpha: false });
    if (!c) throw new Error('This browser cannot draw video.');
    this.ctx = c;
    this.resize(previewDimensions(this.shape));
  }

  get time() { return this.t; }
  get isPlaying() { return this.playing; }

  setStoryboard(scenes: Scene[], pictures: Map<string, ScenePicture>, shape: AspectKey) {
    this.scenes = scenes;
    this.pictures = pictures;
    this.shape = shape;
    if (!this.exporting) this.resize(previewDimensions(shape));
    this.t = Math.min(this.t, totalSeconds(scenes));
    if (!this.playing) this.draw(this.t);
  }

  setSound(settings: SoundSettings, ownAudio: AudioBuffer | null) {
    this.soundSettings = settings;
    // A change while the preview is playing is heard the next time it plays.
    this.ownAudio = ownAudio;
  }

  decodeAudio(blob: Blob): Promise<AudioBuffer> {
    return this.sound.decode(blob);
  }

  seek(t: number) {
    this.pause();
    this.t = Math.min(Math.max(0, t), totalSeconds(this.scenes));
    this.onTime(this.t);
    this.draw(this.t);
  }

  play() {
    if (this.playing || this.scenes.length === 0) return;
    if (this.t >= totalSeconds(this.scenes) - 0.05) this.t = 0;
    this.playing = true;
    this.sound.start({ settings: this.soundSettings, ownAudio: this.ownAudio, total: totalSeconds(this.scenes), from: this.t, record: false });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.sound.stop();
  }

  destroy() {
    this.pause();
    this.sound.destroy();
  }

  /** Records the whole video at normal speed. Rejects with Error('cancelled') when aborted. */
  exportVideo(quality: '720p' | '1080p', opts: { onProgress: (fraction: number) => void; signal: AbortSignal; format?: ExportFormat | null }): Promise<StoryboardExport> {
    const format = opts.format === undefined ? pickExportFormat() : opts.format;
    if (this.exporting) return Promise.reject(new Error('An export is already running.'));
    if (!format || typeof MediaRecorder === 'undefined') return Promise.reject(new Error('This browser cannot record video.'));
    const total = totalSeconds(this.scenes);
    if (total <= 0) return Promise.reject(new Error('Add scenes first.'));
    this.exporting = true;
    this.pause();
    const size = outputSize(this.shape, quality);
    this.resize(size);
    this.draw(0);

    const stream = this.canvas.captureStream(30);
    const withSound = hasSound(this.soundSettings, Boolean(this.ownAudio));
    const audioTrack = withSound ? this.sound.start({ settings: this.soundSettings, ownAudio: this.ownAudio, total, from: 0, record: true }) : null;
    if (audioTrack) stream.addTrack(audioTrack);
    const recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: EXPORT_BITRATE, ...(audioTrack ? { audioBitsPerSecond: 128_000 } : {}) });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });

    const restore = () => {
      cancelAnimationFrame(this.raf);
      this.sound.stop();
      stream.getTracks().forEach((track) => track.stop());
      this.exporting = false;
      this.resize(previewDimensions(this.shape));
      this.t = 0;
      this.draw(0);
    };

    return new Promise((resolve, reject) => {
      let finished = false;
      const fail = (error: Error) => { if (finished) return; finished = true; opts.signal.removeEventListener('abort', onAbort); try { recorder.stop(); } catch { /* already stopped */ } restore(); reject(error); };
      const onAbort = () => fail(new Error('cancelled'));
      if (opts.signal.aborted) return onAbort();
      opts.signal.addEventListener('abort', onAbort, { once: true });
      recorder.onerror = () => fail(new Error('The browser could not record this video.'));

      const started = performance.now();
      const frame = () => {
        if (finished) return;
        const t = (performance.now() - started) / 1000;
        if (t >= total) {
          this.draw(total - 1e-3);
          opts.onProgress(1);
          finished = true;
          opts.signal.removeEventListener('abort', onAbort);
          // Let the last frame reach the recorder before it is closed.
          setTimeout(() => {
            try { recorder.stop(); } catch { /* already stopped */ }
            void stopped.then(() => {
              restore();
              const blob = new Blob(chunks, { type: format.mimeType.split(';')[0] });
              if (blob.size === 0) reject(new Error('The browser produced an empty file. Try again, or use a different browser.'));
              else resolve({ blob, extension: format.extension, seconds: total, width: size.width, height: size.height, instagramSafe: format.instagramSafe, hasSound: withSound });
            });
          }, 400);
          return;
        }
        this.draw(t);
        opts.onProgress(t / total);
        this.raf = requestAnimationFrame(frame);
      };
      recorder.start(500);
      this.raf = requestAnimationFrame(frame);
    });
  }

  /* ── internals ── */

  private resize({ width, height }: { width: number; height: number }) {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  private draw(t: number) {
    drawStoryboardFrame(this.ctx, this.canvas.width, this.canvas.height, this.scenes, this.pictures, t);
  }

  private tick = () => {
    if (!this.playing) return;
    const now = performance.now();
    this.t += (now - this.last) / 1000;
    this.last = now;
    const total = totalSeconds(this.scenes);
    if (this.t >= total) {
      this.playing = false;
      this.sound.stop();
      this.t = total;
      this.draw(total - 1e-3);
      this.onTime(total);
      this.onEnded();
      return;
    }
    this.draw(this.t);
    this.onTime(this.t);
    this.raf = requestAnimationFrame(this.tick);
  };
}

