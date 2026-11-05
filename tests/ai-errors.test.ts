import assert from 'node:assert/strict';
import test from 'node:test';
import { explainAiError, failureDetail } from '../src/lib/agent/ai-errors';
import { createToolLlm } from '../src/lib/agent/tool-llm';

const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

test('each Anthropic failure gets a specific, actionable sentence', () => {
  assert.match(explainAiError('401 authentication_error') ?? '', /rejected the API key/);
  assert.match(explainAiError('400 invalid_request_error credit_balance') ?? '', /no credit left/);
  assert.match(explainAiError('404 not_found_error') ?? '', /model name/);
  assert.match(explainAiError('429 rate_limit_error') ?? '', /rate limiting/);
  assert.match(explainAiError('529 overloaded_error') ?? '', /overloaded/);
  assert.match(explainAiError('403 permission_error') ?? '', /not allowed/);
  assert.equal(explainAiError(undefined), null);
  assert.equal(explainAiError('weird'), null);
});

test('an empty-balance answer is recognised from its message, and no message text is kept', () => {
  const d = failureDetail(400, { error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } });
  assert.equal(d, '400 invalid_request_error credit_balance');
  assert.doesNotMatch(d, /too low/);
  assert.equal(failureDetail(500, null), '500');
});

test('the tool-use client reports the failure detail the owner needs', async () => {
  const llm = createToolLlm({ apiKey: 'k', fetchImpl: reply(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  const r = await llm({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, 'http_error');
  assert.equal(!r.ok && r.detail, '401 authentication_error');
});

test('a 400 from the provider shows the provider’s own reason', () => {
  assert.match(explainAiError('400 invalid_argument | Unknown name "foo" at tools') ?? '', /Unknown name "foo" at tools/);
});
