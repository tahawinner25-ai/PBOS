import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { toFeedItem, type ActionRow } from '../src/lib/agent/activity';
import { TOOLS } from '../src/lib/agent/tools/specs';
import { changeCheckFor, confirmChange, VERIFIABLE_KINDS, verifyRecord, type ReadBack } from '../src/lib/agent/verify';

const CREATOR = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0';
const OTHER = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0';
const ID = '4a4a4a4a-4a4a-4a4a-8a4a-4a4a4a4a4a4a';

/** A fake database: a list of rows per table, filtered by the id and creator_id the code asks for. Records every query. */
function fakeDb(tables: Record<string, Array<Record<string, unknown>>>, opts: { error?: boolean; throws?: boolean } = {}) {
  const log: Array<{ table: string; columns: string; filters: Record<string, string> }> = [];
  const db: ReadBack = {
    from(table) {
      return {
        select(columns) {
          const filters: Record<string, string> = {};
          const chain = { eq(c: string, v: string) { filters[c] = v; return chain; }, maybeSingle: async () => {
            log.push({ table, columns, filters: { ...filters } });
            if (opts.throws) throw new Error('boom');
            if (opts.error) return { data: null, error: { code: 'XX000' } };
            const row = (tables[table] ?? []).find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
            return { data: row ?? null, error: null };
          } };
          return { eq: chain.eq } as never;
        },
      };
    },
  };
  return { db, log };
}

test('a record that exists for this creator is confirmed, and the lookup is creator-filtered', async () => {
  const { db, log } = fakeDb({ ideas: [{ id: ID, creator_id: CREATOR, hook: 'x' }] });
  assert.deepEqual(await verifyRecord(db, CREATOR, { kind: 'idea', id: ID }), { ok: true });
  assert.equal(log[0].filters.creator_id, CREATOR);
  assert.equal(log[0].filters.id, ID);
});

test('a record that is missing, or belongs to someone else, is not confirmed', async () => {
  const { db } = fakeDb({ ideas: [{ id: ID, creator_id: OTHER, hook: 'x' }] });
  const v = await verifyRecord(db, CREATOR, { kind: 'idea', id: ID });
  assert.equal(v.ok, false);
  assert.equal((await verifyRecord(fakeDb({}).db, CREATOR, { kind: 'post', id: ID })).ok, false);
});

test('content checks: an empty script, missing variants or a non-draft job are refused', async () => {
  const mine = { id: ID, creator_id: CREATOR };
  assert.equal((await verifyRecord(fakeDb({ ideas: [{ ...mine, script: '   ' }] }).db, CREATOR, { kind: 'idea_script', id: ID })).ok, false);
  assert.equal((await verifyRecord(fakeDb({ ideas: [{ ...mine, script: 'Hello' }] }).db, CREATOR, { kind: 'idea_script', id: ID })).ok, true);
  assert.equal((await verifyRecord(fakeDb({ ideas: [{ ...mine, hook_variants: [] }] }).db, CREATOR, { kind: 'idea_variants', id: ID })).ok, false);
  assert.equal((await verifyRecord(fakeDb({ ideas: [{ ...mine, hook_variants: [{ hook: 'a' }] }] }).db, CREATOR, { kind: 'idea_variants', id: ID })).ok, true);
  assert.equal((await verifyRecord(fakeDb({ publish_jobs: [{ ...mine, status: 'approved' }] }).db, CREATOR, { kind: 'publish_job', id: ID })).ok, false);
  assert.equal((await verifyRecord(fakeDb({ publish_jobs: [{ ...mine, status: 'draft' }] }).db, CREATOR, { kind: 'publish_job', id: ID })).ok, true);
  assert.equal((await verifyRecord(fakeDb({ ad_creatives: [{ ...mine, status: 'approved' }] }).db, CREATOR, { kind: 'ad', id: ID })).ok, false);
});

test('database errors, thrown errors and unknown kinds are never reported as confirmed', async () => {
  assert.equal((await verifyRecord(fakeDb({}, { error: true }).db, CREATOR, { kind: 'idea', id: ID })).ok, false);
  assert.equal((await verifyRecord(fakeDb({}, { throws: true }).db, CREATOR, { kind: 'idea', id: ID })).ok, false);
  assert.equal((await verifyRecord(fakeDb({}).db, CREATOR, { kind: 'mystery', id: ID })).ok, false);
});

test('every kind a create tool can return is one the verifier knows', () => {
  const made = [...readFileSync(new URL('../src/lib/server/agent-create.ts', import.meta.url), 'utf8').matchAll(/made\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(made.length >= 7, `found ${made.length} made() calls`);
  for (const kind of new Set(made)) assert.ok(VERIFIABLE_KINDS.includes(kind), `${kind} has no verification`);
});

test('every create tool that makes a record is wrapped in verified() in agent-tools', () => {
  const src = readFileSync(new URL('../src/lib/server/agent-tools.ts', import.meta.url), 'utf8');
  for (const t of TOOLS.filter((x) => x.tier === 'create' && x.name !== 'write_draft')) {
    assert.match(src, new RegExp(`${t.name}: verified\\(`), `${t.name} is not verified`);
  }
});

test('approved changes: matching value confirms, mismatch or missing row does not', async () => {
  const args = { deal_id: ID, stage: 'contracted' };
  assert.equal((await confirmChange(fakeDb({ deals: [{ id: ID, creator_id: CREATOR, stage: 'contracted' }] }).db, CREATOR, 'move_deal', args)).ok, true);
  const wrong = await confirmChange(fakeDb({ deals: [{ id: ID, creator_id: CREATOR, stage: 'negotiating' }] }).db, CREATOR, 'move_deal', args);
  assert.equal(wrong.ok, false);
  assert.equal((await confirmChange(fakeDb({}).db, CREATOR, 'move_deal', args)).ok, false);
  assert.equal((await confirmChange(fakeDb({ deals: [{ id: ID, creator_id: OTHER, stage: 'contracted' }] }).db, CREATOR, 'move_deal', args)).ok, false);
});

test('schedule_idea accepts a date or a timestamp that starts with it; set_invoice_status reads the right table', async () => {
  const a = { idea_id: ID, date: '2026-11-02' };
  assert.equal((await confirmChange(fakeDb({ ideas: [{ id: ID, creator_id: CREATOR, scheduled_for: '2026-11-02' }] }).db, CREATOR, 'schedule_idea', a)).ok, true);
  assert.equal((await confirmChange(fakeDb({ ideas: [{ id: ID, creator_id: CREATOR, scheduled_for: '2026-11-02T00:00:00+00:00' }] }).db, CREATOR, 'schedule_idea', a)).ok, true);
  assert.equal((await confirmChange(fakeDb({ ideas: [{ id: ID, creator_id: CREATOR, scheduled_for: '2026-11-03' }] }).db, CREATOR, 'schedule_idea', a)).ok, false);
  assert.equal(changeCheckFor('set_invoice_status', { invoice_id: ID, status: 'paid' })?.table, 'revenue_entries');
  assert.equal(changeCheckFor('log_metrics', { post_id: ID }), null);
  assert.equal(changeCheckFor('move_deal', { deal_id: 5 }), null);
});

test('the feed shows "verified" only for finished creates and approved changes that were confirmed', () => {
  const row = (over: Partial<ActionRow>): ActionRow => ({ id: ID, run_id: ID, tool: 'create_idea', tier: 'create', status: 'done', summary: 's', args: {}, result: { kind: 'idea', id: ID, href: '/ideas', verified: true }, created_at: '2026-10-25T10:00:00Z', decided_at: null, ...over });
  assert.equal(toFeedItem(row({})).verified, true);
  assert.equal(toFeedItem(row({ result: { kind: 'idea', id: ID, href: '/ideas' } })).verified, undefined);
  assert.equal(toFeedItem(row({ status: 'undone' })).verified, undefined);
  assert.equal(toFeedItem(row({ tool: 'move_deal', tier: 'change', status: 'approved', result: { message: 'Moved', verified: true } })).verified, true);
  assert.equal(toFeedItem(row({ tool: 'move_deal', tier: 'change', status: 'failed', result: { error: 'x', verified: true } })).verified, undefined);
});
