/**
 * Sound for storyboard videos, all made in the creator's own browser: a small original background track written
 * with Web Audio oscillators (no service, no key, no download, no licence to worry about), and an optional audio
 * file the creator brings, such as a voice-over recording. Both are mixed into the recording.
 *
 * The note plan is pure and deterministic, so it is unit-tested; the engine around it needs a browser.
 */

export const MUSIC_MOODS = ['none', 'calm', 'warm', 'bright', 'cinematic'] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

export const MOOD_INFO: Record<MusicMood, { label: string; hint: string }> = {
  none: { label: 'No music', hint: 'Silent, unless you add your own audio.' },
  calm: { label: 'Calm', hint: 'Slow, soft, airy.' },
  warm: { label: 'Warm', hint: 'Gentle and friendly, with a soft pluck.' },
  bright: { label: 'Bright', hint: 'Light and upbeat.' },
  cinematic: { label: 'Cinematic', hint: 'Low and slow, with a deep drone.' },
};
export const isMood = (m: unknown): m is MusicMood => typeof m === 'string' && (MUSIC_MOODS as readonly string[]).includes(m);

export type SoundSettings = {
  mood: MusicMood;
  /** 0 to 1 */
  musicVolume: number;
  /** Volume of the creator's own audio file, 0 to 1 */
  ownVolume: number;
};

export const DEFAULT_SOUND: SoundSettings = { mood: 'none', musicVolume: 0.35, ownVolume: 1 };

export const OWN_AUDIO_MAX_BYTES = 15 * 1024 * 1024;
export const OWN_AUDIO_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm'];
/** How long the music fades in at the start and out at the end of the video. */
export const FADE_IN = 0.6;
export const FADE_OUT = 1.8;

const unit = (n: unknown, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback);
export function cleanSound(raw: Partial<SoundSettings> | null | undefined): SoundSettings {
  return { mood: isMood(raw?.mood) ? raw!.mood! : DEFAULT_SOUND.mood, musicVolume: unit(raw?.musicVolume, DEFAULT_SOUND.musicVolume), ownVolume: unit(raw?.ownVolume, DEFAULT_SOUND.ownVolume) };
}

/** True when the finished video would carry an audio track. */
export const hasSound = (s: SoundSettings, ownAudio: boolean): boolean => (s.mood !== 'none' && s.musicVolume > 0) || (ownAudio && s.ownVolume > 0);

/* ── the music ─────────────────────────────────────────────────────────── */

export type Note = { start: number; duration: number; freq: number; gain: number; wave: 'sine' | 'triangle' };

const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

type Mood = { bpm: number; chords: number[][]; bass: number[]; pad: Note['wave']; arpeggio: number[] | null; arpWave: Note['wave']; drone: number | null };

// Chords are MIDI note numbers. Every mood is four bars that loop.
const MOODS: Record<Exclude<MusicMood, 'none'>, Mood> = {
  calm: { bpm: 66, chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], bass: [45, 41, 36, 43], pad: 'sine', arpeggio: null, arpWave: 'sine', drone: null },
  warm: { bpm: 84, chords: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], bass: [48, 43, 45, 41], pad: 'triangle', arpeggio: [0, 1, 2, 1], arpWave: 'triangle', drone: null },
  bright: { bpm: 112, chords: [[67, 71, 74], [62, 66, 69], [64, 67, 71], [60, 64, 67]], bass: [55, 50, 52, 48], pad: 'sine', arpeggio: [0, 2, 1, 2, 0, 2, 1, 2], arpWave: 'triangle', drone: null },
  cinematic: { bpm: 58, chords: [[57, 60, 64], [52, 55, 59], [53, 57, 60], [55, 59, 62]], bass: [33, 28, 29, 31], pad: 'triangle', arpeggio: null, arpWave: 'sine', drone: 33 },
};

/** Every note of the background track for a video of `seconds`, in time order. Deterministic. */
export function musicPlan(mood: MusicMood, seconds: number): Note[] {
  if (mood === 'none' || !(seconds > 0)) return [];
  const m = MOODS[mood];
  const beat = 60 / m.bpm;
  const bar = beat * 4;
  const notes: Note[] = [];
  const add = (n: Note) => {
    if (n.start >= seconds) return;
    notes.push({ ...n, duration: Math.min(n.duration, seconds - n.start) });
  };
  for (let b = 0; b * bar < seconds; b += 1) {
    const at = b * bar;
    const i = b % m.chords.length;
    for (const pitch of m.chords[i]) add({ start: at, duration: bar * 1.02, freq: midi(pitch), gain: 0.05, wave: m.pad });
    add({ start: at, duration: bar * 1.02, freq: midi(m.bass[i]), gain: 0.09, wave: 'sine' });
    if (m.drone !== null) add({ start: at, duration: bar * 1.02, freq: midi(m.drone), gain: 0.05, wave: 'sine' });
    if (m.arpeggio) {
      const step = bar / m.arpeggio.length;
      m.arpeggio.forEach((degree, k) => add({ start: at + k * step, duration: step * 1.6, freq: midi(m.chords[i][degree] + 12), gain: 0.045, wave: m.arpWave }));
    }
  }
  return notes.sort((a, z) => a.start - z.start);
}

/** Volume of the whole mix at time t of a video of `total` seconds: a short fade in and a longer fade out. */
export function fadeAt(t: number, total: number): number {
  if (!(total > 0)) return 0;
  const inn = Math.min(1, Math.max(0, t / FADE_IN));
  const out = Math.min(1, Math.max(0, (total - t) / Math.min(FADE_OUT, total)));
  return Math.min(inn, out);
}

/* ── the engine (browser only) ─────────────────────────────────────────── */

type StartOptions = {
  settings: SoundSettings;
  ownAudio: AudioBuffer | null;
  total: number;
  /** Where in the video to start, in seconds. */
  from: number;
  /** True to send the sound to a recording track instead of the speakers. */
  record: boolean;
};

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private live: Array<{ stop(): void; disconnect(): void }> = [];
  private dest: MediaStreamAudioDestinationNode | null = null;

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
    if (!Ctor) return null;
    this.ctx = new Ctor();
    return this.ctx;
  }

  /** Decodes an audio file the creator chose. Rejects with a plain message when the browser cannot read it. */
  async decode(blob: Blob): Promise<AudioBuffer> {
    const Ctor = typeof window !== 'undefined' ? (window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext) : undefined;
    if (!Ctor) throw new Error('This browser cannot read audio files.');
    try {
      return await new Ctor(2, 1, 44_100).decodeAudioData(await blob.arrayBuffer());
    } catch {
      throw new Error('This browser could not read that audio file. Try an MP3, WAV or M4A.');
    }
  }

  /** Starts the sound. Returns the recording track when `record` is true, else null. Call from a click so the browser allows sound. */
  start(o: StartOptions): MediaStreamTrack | null {
    this.stop();
    const ctx = this.context();
    if (!ctx || !hasSound(o.settings, Boolean(o.ownAudio))) return null;
    void ctx.resume().catch(() => undefined);

    const t0 = ctx.currentTime + 0.06;
    const remaining = Math.max(0, o.total - o.from);
    const master = ctx.createGain();
    this.live.push(master as unknown as { stop(): void; disconnect(): void });
    // The fades are drawn as a few straight segments of the volume curve.
    master.gain.setValueAtTime(fadeAt(o.from, o.total), t0);
    for (const t of [o.from + FADE_IN, o.total - FADE_OUT, o.total]) {
      if (t > o.from && t <= o.total) master.gain.linearRampToValueAtTime(fadeAt(t, o.total), t0 + (t - o.from));
    }
    if (o.record) {
      this.dest = ctx.createMediaStreamDestination();
      master.connect(this.dest);
    } else {
      master.connect(ctx.destination);
    }

    if (o.settings.mood !== 'none' && o.settings.musicVolume > 0) {
      const bus = ctx.createGain();
      bus.gain.value = o.settings.musicVolume;
      bus.connect(master);
      this.live.push(bus as unknown as { stop(): void; disconnect(): void });
      for (const n of musicPlan(o.settings.mood, o.total)) {
        const end = n.start + n.duration;
        if (end <= o.from) continue;
        const begin = Math.max(n.start, o.from);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = n.wave;
        osc.frequency.value = n.freq;
        const s = t0 + (begin - o.from);
        const e = t0 + (end - o.from);
        const attack = Math.min(0.35, (e - s) / 3);
        const release = Math.min(0.6, (e - s) / 2);
        env.gain.setValueAtTime(0, s);
        env.gain.linearRampToValueAtTime(n.gain, s + attack);
        env.gain.setValueAtTime(n.gain, Math.max(s + attack, e - release));
        env.gain.linearRampToValueAtTime(0, e);
        osc.connect(env).connect(bus);
        osc.start(s);
        osc.stop(e + 0.05);
        osc.onended = () => { try { osc.disconnect(); env.disconnect(); } catch { /* already gone */ } };
        this.live.push(osc);
      }
    }

    if (o.ownAudio && o.settings.ownVolume > 0 && o.from < o.ownAudio.duration) {
      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = o.ownAudio;
      gain.gain.value = o.settings.ownVolume;
      src.connect(gain).connect(master);
      src.start(t0, o.from);
      this.live.push(src);
      this.live.push(gain as unknown as { stop(): void; disconnect(): void });
    }
    return this.dest ? (this.dest.stream.getAudioTracks()[0] ?? null) : null;
  }

  stop() {
    for (const node of this.live) {
      try { node.stop(); } catch { /* not a source, or already stopped */ }
      try { node.disconnect(); } catch { /* already disconnected */ }
    }
    this.live = [];
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.dest = null;
  }

  destroy() {
    this.stop();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }
}
