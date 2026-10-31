import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentAccountId, dailySeries, instagramView, lastDays, latestCurrent, total, youtubeView, type StatPoint } from '../src/lib/platform-stats';

const pt = (o: Partial<StatPoint> & Pick<StatPoint, 'platform' | 'metric' | 'kind' | 'day' | 'value'>): StatPoint => ({ scope: 'account', external_id: 'UC1', window_days: null, fetched_at: '2026-10-22T10:00:00Z', ...o });

function days(n: number, from = '2026-10-01') {
  const base = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base + i * 86_400_000).toISOString().slice(0, 10));
}

test('empty input shows nothing, never zeros', () => {
  const yt = youtubeView([]);
  assert.equal(yt.hasData, false);
  assert.deepEqual(yt.stats, []);
  assert.equal(yt.series, null);
  assert.equal(yt.lastFetchedAt, null);
  assert.equal(instagramView([]).hasData, false);
});

test('YouTube totals cover only the last 28 returned days and say so', () => {
  const rows: StatPoint[] = [];
  for (const d of days(40)) rows.push(pt({ platform: 'youtube', metric: 'views', kind: 'daily', day: d, value: 10 }));
  const v = youtubeView(rows).stats.find((s) => s.label === 'Views');
  assert.equal(v?.value, '280');
  assert.equal(v?.hint, 'Last 28 days');
});

test('a partial window is labelled, not extrapolated', () => {
  const rows = days(5).map((d) => pt({ platform: 'youtube', metric: 'views', kind: 'daily', day: d, value: 100 }));
  const v = youtubeView(rows).stats.find((s) => s.label === 'Views');
  assert.equal(v?.value, '500');
  assert.match(v?.hint ?? '', /5 of the last 28 days/);
});

test('net subscribers needs both gained and lost, and subtracts', () => {
  const g = days(3).map((d) => pt({ platform: 'youtube', metric: 'subscribersGained', kind: 'daily', day: d, value: 4 }));
  const only = youtubeView(g).stats.find((s) => s.label === 'Net subscribers');
  assert.equal(only, undefined);
  const l = days(3).map((d) => pt({ platform: 'youtube', metric: 'subscribersLost', kind: 'daily', day: d, value: 1 }));
  const net = youtubeView([...g, ...l]).stats.find((s) => s.label === 'Net subscribers');
  assert.equal(net?.value, '+9');
});

test('watch time is converted from minutes to hours', () => {
  const rows = days(2).map((d) => pt({ platform: 'youtube', metric: 'estimatedMinutesWatched', kind: 'daily', day: d, value: 90 }));
  assert.equal(youtubeView(rows).stats.find((s) => s.label === 'Watch time (hours)')?.value, '3');
});

test('only the most recently synced account is used after a reconnect', () => {
  const oldRows = [pt({ platform: 'youtube', metric: 'subscribers', kind: 'current', day: '2026-09-01', value: 999, external_id: 'OLD', fetched_at: '2026-09-01T00:00:00Z' })];
  const newRows = [pt({ platform: 'youtube', metric: 'subscribers', kind: 'current', day: '2026-10-22', value: 120, external_id: 'NEW', fetched_at: '2026-10-22T00:00:00Z' })];
  assert.equal(currentAccountId([...oldRows, ...newRows], 'youtube'), 'NEW');
  assert.equal(latestCurrent([...oldRows, ...newRows], 'youtube', 'subscribers')?.value, 120);
});

test('media-scope rows never leak into account figures', () => {
  const rows = [pt({ platform: 'youtube', metric: 'views', kind: 'daily', day: '2026-10-01', value: 5, scope: 'media', external_id: 'vid' })];
  assert.equal(youtubeView(rows).hasData, false);
});

test('Instagram reach is a daily average, never a sum', () => {
  const rows = days(4).map((d, i) => pt({ platform: 'instagram', metric: 'reach', kind: 'daily', day: d, value: (i + 1) * 100, external_id: 'ig1' }));
  const s = instagramView(rows).stats.find((x) => x.label === 'Average daily reach');
  assert.equal(s?.value, '250');
  assert.match(s?.hint ?? '', /Not a unique-people total/);
});

test('Instagram window totals use only 28-day rows and the newest day', () => {
  const rows = [
    pt({ platform: 'instagram', metric: 'views', kind: 'window', window_days: 28, day: '2026-10-10', value: 1, external_id: 'ig1' }),
    pt({ platform: 'instagram', metric: 'views', kind: 'window', window_days: 28, day: '2026-10-20', value: 700, external_id: 'ig1' }),
    pt({ platform: 'instagram', metric: 'views', kind: 'window', window_days: 7, day: '2026-10-21', value: 9, external_id: 'ig1' }),
  ];
  const s = instagramView(rows).stats.find((x) => x.label === 'Views');
  assert.equal(s?.value, '700');
  assert.equal(s?.hint, '28 days to 2026-10-20');
});

test('helpers: lastDays, total, dailySeries dedupe', () => {
  const s = days(10).map((day, i) => ({ day, value: i }));
  assert.equal(lastDays(s, 3).length, 3);
  assert.deepEqual(total([]), null);
  assert.deepEqual(total(s.slice(0, 3)), { sum: 3, days: 3 });
  const dup = [pt({ platform: 'youtube', metric: 'views', kind: 'daily', day: '2026-10-01', value: 1 }), pt({ platform: 'youtube', metric: 'views', kind: 'daily', day: '2026-10-01', value: 2 })];
  assert.equal(dailySeries(dup, 'youtube', 'views').length, 1);
});
