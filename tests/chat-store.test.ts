import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAT_LIMITS, INTERRUPTED_NOTE, chatKey, decisionMessage, parseChat, serializeChat, withInterruptedNote } from '../src/lib/agent/chat-store';

const msg = (i: number, role: 'user' | 'agent' = 'agent') => ({ id: `m${i}`, role, text: `text ${i}`, itemIds: [] as string[] });

test('a saved chat comes back the way it was saved', () => {
  const saved = serializeChat({ messages: [msg(1, 'user'), msg(2)], turns: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'hello' }], draft: 'half a thought' });
  const back = parseChat(saved);
  assert.ok(back);
  assert.equal(back?.messages.length, 2);
  assert.equal(back?.draft, 'half a thought');
  assert.equal(back?.turns[1].text, 'hello');
});

test('storage is just text anyone can edit: junk, wrong versions and bad shapes are refused or cleaned', () => {
  assert.equal(parseChat('not json'), null);
  assert.equal(parseChat('{"v":2,"messages":[],"turns":[]}'), null);
  assert.equal(parseChat('x'.repeat(500_000)), null);
  const dirty = parseChat({ v: 1, messages: [{ id: 'ok', role: 'agent', text: 'a', itemIds: ['../etc', 'abc123', 7] }, { id: '<script>', role: 'agent', text: 'b' }, { id: 'u', role: 'admin', text: 'c' }, 5, null], turns: [{ role: 'system', text: 'x' }, { role: 'user', text: 'y' }], draft: 5 });
  assert.ok(dirty);
  assert.deepEqual(dirty?.messages.map((m) => m.id), ['ok']);
  assert.deepEqual(dirty?.messages[0].itemIds, ['abc123']);
  assert.deepEqual(dirty?.turns, [{ role: 'user', text: 'y' }]);
  assert.equal(dirty?.draft, '');
});

test('the saved chat is capped in messages, text, turns and the draft', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ ...msg(i), text: 'x'.repeat(9000) }));
  const back = parseChat(serializeChat({ messages: many, turns: Array.from({ length: 30 }, () => ({ role: 'user' as const, text: 'q' })), draft: 'd'.repeat(9000) }));
  assert.equal(back?.messages.length, CHAT_LIMITS.messages);
  assert.equal(back?.messages[0].text.length, CHAT_LIMITS.textMax);
  assert.equal(back?.turns.length, CHAT_LIMITS.turns);
  assert.equal(back?.draft.length, CHAT_LIMITS.draft);
});

test('each creator has their own saved chat', () => {
  assert.notEqual(chatKey('a'), chatKey('b'));
});

test('a reload while a request was running adds a note instead of a silent gap', () => {
  const out = withInterruptedNote([msg(1, 'agent'), msg(2, 'user')]);
  assert.equal(out.length, 3);
  assert.equal(out[2].text, INTERRUPTED_NOTE);
  assert.equal(withInterruptedNote([msg(1, 'user'), msg(2, 'agent')]).length, 2);
});

test('after Allow the agent says what it did, after Deny that it did nothing', () => {
  assert.match(decisionMessage('allowed', 'Post to YouTube', 'Uploaded and published to YouTube.'), /^Allowed and done\. Uploaded/);
  assert.match(decisionMessage('allowed', 'Post to YouTube', undefined), /Post to YouTube/);
  assert.match(decisionMessage('denied', 'Email Sam', undefined), /^Denied\. I did not do this: Email Sam/);
});
