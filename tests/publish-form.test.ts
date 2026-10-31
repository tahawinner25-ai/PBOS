import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeApproval, parseComposer } from '../src/lib/publish-form';

const fd = (entries: Array<[string, string]>) => { const f = new FormData(); entries.forEach(([k, v]) => f.append(k, v)); return f; };
const ID = '11111111-1111-4111-8111-111111111111';

describe('parseComposer', () => {
  it('parses a full submission', () => {
    const r = parseComposer(fd([['destinations', 'youtube:short'], ['destinations', 'instagram:reel'], ['title', 'T'], ['caption', 'C'], ['tags', 'a, b ,,c'], ['privacy', 'public'], ['made_for_kids', 'no'], ['scheduled_for', '2026-11-01T10:00:00Z'], ['media_ids', ID], ['idea_id', ID]]));
    assert.ok(r.ok);
    if (r.ok) {
      assert.deepEqual(r.value.destinations, [{ platform: 'youtube', format: 'short' }, { platform: 'instagram', format: 'reel' }]);
      assert.deepEqual(r.value.tags, ['a', 'b', 'c']);
      assert.equal(r.value.madeForKids, false);
      assert.equal(r.value.scheduledFor, '2026-11-01T10:00:00.000Z');
    }
  });
  it('treats missing "made for kids" as unanswered, not as no', () => {
    const r = parseComposer(fd([['destinations', 'youtube:video']]));
    assert.ok(r.ok && r.value.madeForKids === null);
  });
  it('rejects bad input with a message per field', () => {
    assert.ok(!parseComposer(fd([])).ok);
    const e = (f: FormData) => { const r = parseComposer(f); return r.ok ? {} : r.errors; };
    assert.ok(e(fd([['destinations', 'tiktok:video']])).destinations);
    assert.ok(e(fd([['destinations', 'youtube:video'], ['destinations', 'youtube:short']])).destinations);
    assert.ok(e(fd([['destinations', 'instagram:reel'], ['destinations', 'instagram:photo']])).destinations);
    assert.ok(e(fd([['destinations', 'youtube:video'], ['privacy', 'secret']])).privacy);
    assert.ok(e(fd([['destinations', 'youtube:video'], ['scheduled_for', 'soonish']])).scheduledFor);
    assert.ok(e(fd([['destinations', 'instagram:photo'], ['media_ids', "x'; drop table"]])).media);
    assert.ok(e(fd([['destinations', 'instagram:photo'], ['idea_id', 'nope']])).ideaId);
    assert.ok(e(fd([['destinations', 'instagram:carousel'], ...Array.from({ length: 11 }, () => ['media_ids', ID] as [string, string])])).media);
  });
  it('ignores unknown fields (no mass assignment)', () => {
    const r = parseComposer(fd([['destinations', 'youtube:video'], ['status', 'published'], ['approved_at', '2020-01-01'], ['creator_id', ID], ['upload_session_uri', 'https://evil']]));
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.ok ? r.value : {}).sort(), ['caption', 'destinations', 'ideaId', 'madeForKids', 'mediaIds', 'privacy', 'scheduledFor', 'tags', 'title']);
  });
});

describe('describeApproval', () => {
  const base = { platform: 'youtube' as const, format: 'video' as const, title: 'My video', caption: null, privacy: 'public' as const, scheduled_for: null, media_asset_ids: [] };
  it('says what, where, when and who can see it', () => {
    assert.match(describeApproval(base), /“My video” as a YouTube video right away\. Visibility: public\./);
    assert.match(describeApproval({ ...base, scheduled_for: '2030-01-01T00:00:00Z' }, new Date('2026-10-22T00:00:00Z')), /at Tue, 01 Jan 2030 00:00:00 GMT/);
    assert.match(describeApproval({ ...base, platform: 'instagram', format: 'reel', title: null, caption: 'Hello world' }), /an Instagram reel/);
  });
});
