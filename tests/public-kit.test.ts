import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { avatarPublicUrl, buildProof, publicPersona, toPublicProfile } from '../src/lib/public-kit';
import type { AiPersona } from '../src/lib/types';

const persona = (over: Partial<AiPersona> = {}): AiPersona => ({
  enabled: true,
  name: 'Ada',
  description: 'Answers rate questions',
  based_on_real_person: false,
  consent_confirmed: false,
  ...over,
});

const post = (over: Record<string, unknown> = {}) => ({
  platform: 'Instagram',
  format: 'Short video',
  published_at: '2026-10-01T10:00:00Z',
  views: 1000,
  likes: 50,
  comments: 5,
  shares: 3,
  saves: 2,
  clicks: null,
  is_demo: false,
  ...over,
});

describe('publicPersona', () => {
  it('hides a disabled or incomplete persona', () => {
    assert.equal(publicPersona(null), null);
    assert.equal(publicPersona(persona({ enabled: false })), null);
    assert.equal(publicPersona(persona({ name: '  ' })), null);
    assert.equal(publicPersona(persona({ description: '' })), null);
  });

  it('requires consent for a persona based on a real person', () => {
    assert.equal(publicPersona(persona({ based_on_real_person: true })), null);
    assert.ok(publicPersona(persona({ based_on_real_person: true, consent_confirmed: true })));
    assert.ok(publicPersona(persona()));
  });
});

describe('toPublicProfile', () => {
  const row = {
    id: 'p1',
    name: ' Sam Rivera ',
    niche: 'Money',
    positioning: 'Helps freelancers',
    voice: 'direct',
    services: [],
    rate_card: [],
    faq: [],
    ai_persona: null,
    avatar_path: 'u1/avatar.png',
  };

  it('exposes only whitelisted fields', () => {
    const pub = toPublicProfile({ ...row, goals: { primary: 'secret' }, audience_notes: 'private', user_id: 'u1' } as typeof row, 'https://x.supabase.co/');
    assert.ok(pub);
    assert.deepEqual(Object.keys(pub as object).sort(), ['ai_persona', 'avatar_url', 'faq', 'id', 'name', 'niche', 'positioning', 'rate_card', 'services', 'voice']);
    assert.equal(pub?.name, 'Sam Rivera');
    assert.equal(pub?.avatar_url, 'https://x.supabase.co/storage/v1/object/public/creator-assets/u1/avatar.png');
  });

  it('returns null without a name', () => {
    assert.equal(toPublicProfile({ ...row, name: ' ' }, undefined), null);
    assert.equal(toPublicProfile({ ...row, name: null }, undefined), null);
  });

  it('builds no avatar url without a path or a storage host', () => {
    assert.equal(avatarPublicUrl(null, 'https://x.supabase.co'), null);
    assert.equal(avatarPublicUrl('a.png', undefined), null);
  });
});

describe('buildProof', () => {
  it('counts only real posts with metrics and never demo posts', () => {
    const proof = buildProof([
      post(),
      post({ platform: 'TikTok', views: 500, likes: 10 }),
      post({ is_demo: true, views: 999999 }),
      post({ views: null, likes: null, comments: null, shares: null, saves: null, clicks: null }),
    ]);
    assert.equal(proof.posts_with_metrics, 2);
    assert.deepEqual(proof.platforms, ['Instagram', 'TikTok']);
    assert.equal(proof.recent.length, 2);
    assert.ok(proof.recent.every((r) => r.views !== 999999));
  });

  it('reports no engagement rate without views and caps recent posts at five', () => {
    const proof = buildProof([post({ views: null, likes: 5 }), ...Array.from({ length: 8 }, () => post())]);
    assert.equal(proof.recent.length, 5);
    assert.equal(proof.recent[0].engagement_rate, null);
    assert.ok((proof.recent[1].engagement_rate ?? 0) > 0);
  });

  it('is empty when there is nothing real to show', () => {
    assert.deepEqual(buildProof([]), { posts_with_metrics: 0, platforms: [], recent: [] });
    assert.equal(buildProof([post({ is_demo: true })]).posts_with_metrics, 0);
  });
});
