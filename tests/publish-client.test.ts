import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALLOWED_UPLOAD_MIME, EXTENSION, MEDIA_MAX_BYTES, sniffMedia } from '../src/lib/media-sniff';
import { uploadYouTubeFile } from '../src/lib/publish-client';

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pad = (b: number[], n = 16) => new Uint8Array([...b, ...Array(Math.max(0, n - b.length)).fill(0)]);

describe('sniffMedia', () => {
  it('recognises real media by its bytes', () => {
    assert.deepEqual(sniffMedia(pad([0xff, 0xd8, 0xff, 0xe0])), { kind: 'image', mime: 'image/jpeg' });
    assert.deepEqual(sniffMedia(pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { kind: 'image', mime: 'image/png' });
    assert.deepEqual(sniffMedia(pad([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')])), { kind: 'image', mime: 'image/webp' });
    assert.deepEqual(sniffMedia(pad([0, 0, 0, 24, ...ascii('ftypisom')])), { kind: 'video', mime: 'video/mp4' });
    assert.deepEqual(sniffMedia(pad([0, 0, 0, 20, ...ascii('ftypqt  ')])), { kind: 'video', mime: 'video/quicktime' });
  });
  it('rejects disguised or unknown content', () => {
    assert.equal(sniffMedia(new Uint8Array(ascii('<?php echo 1; ?>   '))), null);
    assert.equal(sniffMedia(new Uint8Array(ascii('#!/bin/sh\nrm -rf /\n'))), null);
    assert.equal(sniffMedia(new Uint8Array(ascii('MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00'))), null, 'a Windows executable');
    assert.equal(sniffMedia(pad([0xff, 0xd8])), null, 'too short to be sure');
    assert.equal(sniffMedia(new Uint8Array(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))), null, 'SVG can carry script and is not accepted');
  });
  it('limits are explicit', () => {
    assert.equal(MEDIA_MAX_BYTES, 52_428_800);
    assert.ok(ALLOWED_UPLOAD_MIME.every((m) => EXTENSION[m]));
    assert.ok(!(ALLOWED_UPLOAD_MIME as readonly string[]).includes('image/svg+xml'));
  });
});

/** A fake server speaking the begin/chunk protocol. */
function fakeServer(opts: { chunkSize?: number; total: number; failChunkOnce?: number; mismatchOnce?: boolean; beginStatus?: number; resumeAt?: number }) {
  const chunkSize = opts.chunkSize ?? 262_144 * 2;
  const log: string[] = [];
  let expected = opts.resumeAt ?? 0;
  let failed = false;
  let mismatched = false;
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (url.endsWith('/begin')) {
      log.push('begin');
      if (opts.beginStatus) return j({ error: 'Approve the post before uploading.' }, opts.beginStatus);
      return j({ offset: expected, chunkSize, resumed: expected > 0 });
    }
    const offset = Number(new URL(url, 'http://x').searchParams.get('offset'));
    log.push(`chunk@${offset}`);
    if (opts.failChunkOnce !== undefined && offset === opts.failChunkOnce && !failed) { failed = true; throw new TypeError('network'); }
    if (opts.mismatchOnce && !mismatched) { mismatched = true; return j({ error: 'The upload position changed. Resuming.', expected }, 409); }
    if (offset !== expected) return j({ error: 'bad offset', expected }, 409);
    const len = (init?.body as Blob).size;
    expected += len;
    if (expected >= opts.total) return j({ done: true, url: 'https://www.youtube.com/watch?v=vid1' });
    return j({ done: false, nextOffset: expected });
  }) as typeof fetch;
  return { fetchImpl, log };
}

const file = (size: number) => new Blob([new Uint8Array(size)], { type: 'video/mp4' });
const noSleep = async () => {};

describe('uploadYouTubeFile', () => {
  it('uploads in order and reports progress up to 100', async () => {
    const total = 262_144 * 5 + 100;
    const server = fakeServer({ total });
    const seen: number[] = [];
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(total), fetchImpl: server.fetchImpl, sleep: noSleep, onProgress: (p) => seen.push(p.percent) });
    assert.deepEqual(out, { ok: true, videoUrl: 'https://www.youtube.com/watch?v=vid1' });
    assert.deepEqual(server.log, ['begin', 'chunk@0', `chunk@${262_144 * 2}`, `chunk@${262_144 * 4}`]);
    assert.equal(seen.at(-1), 100);
    assert.ok(seen.every((v, i) => i === 0 || v >= seen[i - 1]), 'progress never goes backwards');
  });
  it('retries a dropped chunk and carries on', async () => {
    const total = 262_144 * 4;
    const server = fakeServer({ total, failChunkOnce: 262_144 * 2 });
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(total), fetchImpl: server.fetchImpl, sleep: noSleep });
    assert.equal(out.ok, true);
    assert.equal(server.log.filter((l) => l === `chunk@${262_144 * 2}`).length, 2);
  });
  it('gives up after repeated failures and says how to resume', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/begin')) return new Response(JSON.stringify({ offset: 0, chunkSize: 262_144 }), { status: 200 });
      throw new TypeError('offline');
    }) as typeof fetch;
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(262_144 * 2), fetchImpl, sleep: noSleep, maxChunkAttempts: 3 });
    assert.equal(out.ok, false);
    assert.ok(!out.ok && out.retryable && /resume/.test(out.error));
  });
  it('follows the server when it reports a different position (resume after a refresh)', async () => {
    const total = 262_144 * 4;
    const server = fakeServer({ total, mismatchOnce: true, resumeAt: 262_144 * 2 });
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(total), fetchImpl: server.fetchImpl, sleep: noSleep });
    assert.equal(out.ok, true);
    assert.ok(!server.log.includes('chunk@0') || server.log.indexOf(`chunk@${262_144 * 2}`) >= 0);
  });
  it('resumes from the offset the server says it has', async () => {
    const total = 262_144 * 4;
    const server = fakeServer({ total, resumeAt: 262_144 * 2 });
    await uploadYouTubeFile({ jobId: 'j1', file: file(total), fetchImpl: server.fetchImpl, sleep: noSleep });
    assert.deepEqual(server.log, ['begin', `chunk@${262_144 * 2}`]);
  });
  it('shows the server\'s reason when the upload cannot start (for example, not approved)', async () => {
    const server = fakeServer({ total: 1000, beginStatus: 409 });
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(1000), fetchImpl: server.fetchImpl, sleep: noSleep });
    assert.deepEqual(out, { ok: false, error: 'Approve the post before uploading.', retryable: false });
    assert.deepEqual(server.log, ['begin']);
  });
  it('stops when the user pauses', async () => {
    const ctrl = new AbortController();
    const server = fakeServer({ total: 262_144 * 6 });
    const out = await uploadYouTubeFile({ jobId: 'j1', file: file(262_144 * 6), fetchImpl: server.fetchImpl, sleep: noSleep, signal: ctrl.signal, onProgress: () => ctrl.abort() });
    assert.ok(!out.ok && /paused/.test(out.error));
  });
});
