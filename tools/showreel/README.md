# PBOS showreel: "Chaos becomes an operator"

A 15.000 s, 1920×1080, 60 fps film with its own soundtrack, made entirely from code in this folder. It is on the landing page
(`public/showreel/showreel.mp4`, `poster.jpg`) and also runs live in the browser at `/showreel/showreel.html?live=1`.

It contains **no real numbers and no fake social proof**: every card, bar and line is an illustration, and the product scenes carry the
caption "Illustrative example". The only colour besides black, white and grey is one green, used on "Send" and the final button.

## How it is made

| File | What it does |
| --- | --- |
| `src/scene.js` | The whole film as one pure function: `window.seek(t)` sets every style from `t` alone (no CSS animation, no timers, no state), so any frame can be rendered in any order. 21 rounded rectangles morph from scene to scene with a critically damped spring; skins change with bottom-up wipes, never crossfades. |
| `src/style.css`, `src/template.html` | Look and page skeleton. Container query units (`cqw`, `cqh`) make every skin follow the card it lives on. |
| `src/font.css` | Inter (SIL Open Font License 1.1), subset to the weights used and inlined as base64, so the film needs no network. Rebuild with `make-font.py`. |
| `build.mjs` | Inlines font, CSS and JS into one file: `public/showreel/showreel.html`. |
| `audio.mjs` | Synthesises the soundtrack (136 BPM: kick on every beat, hats, a plucked chord per scene, a riser into the last bar, ticks while the command is typed, one stab on the end card) with the Web Audio API, rendered offline inside Chromium. No samples, no third-party music. Peak -1 dBFS. |
| `render.mjs` | Renders 900 frames × 3 sub-frames over a 180° shutter (motion blur), pipes them into ffmpeg (H.264 High, yuv420p, CRF 17), then muxes the audio as AAC. |
| `frames.mjs` | Dev helper: renders chosen timestamps to PNGs so the motion can be looked at. |

## Rebuild

```bash
node tools/showreel/build.mjs
NODE_PATH=<dir with playwright> node tools/showreel/frames.mjs out 0 3 6.4 9 12.9 14.3   # look at stills
NODE_PATH=<dir with playwright> node tools/showreel/audio.mjs                           # -> public/showreel/showreel.wav
NODE_PATH=<dir with playwright> node tools/showreel/render.mjs                          # -> public/showreel/showreel.mp4 (about 6 minutes)
```

Needs Node 18+, Playwright with Chromium, and ffmpeg with libx264 and AAC. The WAV is muxed into the MP4 and is not committed.

## Checks that were run on the shipped file

- `ffprobe`: 15.000 s, 900 frames, 1920×1080, 60 fps, H.264 High yuv420p, AAC stereo 44.1 kHz, 3.1 MB (Instagram and YouTube accept this profile; not tested on either).
- Loop seam: first and last frame differ by a mean of about 0.1 out of 255 per channel.
- No blank frames at nine sampled times; green appears only on "Send" and the end card.
- Audio peak -1.0 dB, mean -17.2 dB.

Not checked: how it looks on every device or in a screen reader (the landing page gives a text version and starts nothing automatically).
