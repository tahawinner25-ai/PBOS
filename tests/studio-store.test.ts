import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyProject, type Project } from '../src/lib/studio/edl';
import { buildStudioSave, parseStudioSave, type StoredSource } from '../src/lib/studio/store';

const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });
const src = (): StoredSource => ({ label: 'a.mp4', origin: 'local', duration: 20, width: 1080, height: 1920, blob });
const project = (): Project => ({
  ...emptyProject(),
  clips: [{ id: 'c1', sourceId: 'file:1', label: 'a.mp4', sourceDuration: 20, start: 1, end: 9, volume: 1 }],
  overlays: [{ id: 'o1', text: 'Hello', start: 0, end: 3, position: 'bottom', size: 'medium', color: 'white', box: true }],
});

test('a saved studio round-trips and unused sources are not kept', () => {
  const save = buildStudioSave(project(), { 'file:1': src(), 'file:unused': src() }, 5);
  assert.deepEqual(Object.keys(save.sources), ['file:1']);
  const back = parseStudioSave(save);
  assert.ok(back);
  assert.equal(back!.project.clips[0].end, 9);
});

test('damaged or hostile saves are refused', () => {
  const good = buildStudioSave(project(), { 'file:1': src() }, 5);
  const clone = () => structuredClone({ ...good, sources: {} }) as unknown as Record<string, unknown>;
  assert.equal(parseStudioSave(null), null);
  assert.equal(parseStudioSave({ ...good, version: 2 }), null);
  assert.equal(parseStudioSave({ ...good, sources: {} }), null, 'a clip points at a missing video');
  assert.equal(parseStudioSave({ ...good, project: { ...good.project, clips: [] } }), null);
  assert.equal(parseStudioSave({ ...good, project: { ...good.project, clips: [{ ...good.project.clips[0], end: 99 }] } }), null, 'trim past the video');
  assert.equal(parseStudioSave({ ...good, project: { ...good.project, clips: [{ ...good.project.clips[0], volume: 5 }] } }), null);
  assert.equal(parseStudioSave({ ...good, project: { ...good.project, overlays: [{ ...good.project.overlays[0], color: 'red' }] } }), null);
  assert.equal(parseStudioSave({ ...good, sources: { 'file:1': { ...src(), blob: 'not a blob' } } }), null);
  assert.equal(parseStudioSave({ ...good, sources: { 'file:1': { ...src(), origin: 'cloud' } } }), null);
  assert.ok(clone());
});
