# Browser tests for the Studio

The Studio's pure editing rules are covered by `tests/studio-edl.test.ts`. These two harnesses cover the parts that only a real browser can show: drawing, seeking, audio, recording, and the editor screens themselves. They are not part of `npm test`, because they need a Chromium download and `ffmpeg`.

## Run them

```bash
npm i -D playwright esbuild react react-dom   # dev tools only; the app already depends on react
npx playwright install chromium
bash tools/browser-tests/make-fixtures.sh     # needs ffmpeg

node tools/browser-tests/engine/build.js && node tools/browser-tests/engine/run.js
node tools/browser-tests/ui/build.js     && node tools/browser-tests/ui/run.js
node tools/browser-tests/ui/run.js --h264     # pretends the browser records H.264, to exercise "Save to my library"
node tools/browser-tests/ui/build-display.js && node tools/browser-tests/ui/run-display.js   # display settings: text size, contrast, font, motion, storage blocked
```

## What they check

- **engine**: reading a video's length and size, seeking to the right clip, text drawn over the picture, one clip's audio after another, volume 0 silencing only that clip, cancelling an export, exporting twice in a row.
- **display settings**: saved choices applied before first paint, persistence, Escape and focus return, reset, tampered or blocked storage.
- **ui**: adding a clip from the library and from a device file, trimming by typing, muting, reordering, text, splitting, undo and redo, changing the shape, the "too short" alert, every control having an accessible name, unique ids, the timeline locking during export, the finished video and download link, and the save-to-library calls.

`--h264` only changes what the browser *claims* it can record (the data is still what Chromium records), so it tests the screens and server calls, not Instagram acceptance. Whether Instagram accepts a file recorded by a given browser has to be checked with a real publish.

The UI harness replaces server actions and icons with small stand-ins (`mock-*.ts`, `*-shim.tsx`) and loads no stylesheet, so it proves behaviour and accessibility names, not visual design.
