import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildCalendar, MIX_NOT_SET } from '../src/lib/calendar';
import type { IdeaStatus } from '../src/lib/constants';

const idea = (id: string, scheduled_for: string | null, content_mix: string | null, status: IdeaStatus = 'scheduled') => ({
  id,
  hook: `Hook ${id}`,
  platform: 'Instagram',
  format: 'Short video',
  content_mix,
  scheduled_for,
  status,
});

describe('buildCalendar', () => {
  const today = '2026-10-17';

  it('groups upcoming ideas by date, soonest first, and ignores unscheduled ideas', () => {
    const cal = buildCalendar(
      [idea('a', '2026-10-20', 'Educational'), idea('b', '2026-10-18', 'Promotional'), idea('c', '2026-10-20', 'Educational'), idea('d', null, 'Educational', 'idea')],
      today,
    );
    assert.deepEqual(cal.upcoming.map((d) => d.date), ['2026-10-18', '2026-10-20']);
    assert.deepEqual(cal.upcoming[1].items.map((i) => i.id), ['a', 'c']);
    assert.equal(cal.upcomingCount, 3);
    assert.equal(cal.slipped.length, 0);
  });

  it('treats today as upcoming and earlier dates as slipped', () => {
    const cal = buildCalendar([idea('a', today, 'Educational'), idea('b', '2026-10-10', 'Educational')], today);
    assert.deepEqual(cal.upcoming.map((d) => d.date), [today]);
    assert.deepEqual(cal.slipped.map((d) => d.date), ['2026-10-10']);
  });

  it('leaves posted and measured ideas out of the calendar', () => {
    const cal = buildCalendar([idea('a', '2026-10-18', 'Educational', 'posted'), idea('b', '2026-10-01', 'Educational', 'measured')], today);
    assert.equal(cal.upcomingCount, 0);
    assert.equal(cal.slipped.length, 0);
    assert.equal(cal.mixNote, null);
  });

  it('counts the content mix and reports a single-mix calendar', () => {
    const cal = buildCalendar([idea('a', '2026-10-18', 'Educational'), idea('b', '2026-10-19', 'Educational'), idea('c', '2026-10-20', 'Educational')], today);
    assert.deepEqual(cal.mix, [{ mix: 'Educational', count: 3 }]);
    assert.match(cal.mixNote ?? '', /All 3 upcoming ideas are Educational/);
  });

  it('says so when no content mix is set, and does not guess', () => {
    const cal = buildCalendar([idea('a', '2026-10-18', null), idea('b', '2026-10-19', null), idea('c', '2026-10-20', null)], today);
    assert.deepEqual(cal.mix, [{ mix: MIX_NOT_SET, count: 3 }]);
    assert.match(cal.mixNote ?? '', /None of your 3 upcoming ideas has a content mix set/);
  });

  it('stays quiet with fewer than three upcoming ideas, or a healthy mix', () => {
    assert.equal(buildCalendar([idea('a', '2026-10-18', 'Educational'), idea('b', '2026-10-19', 'Educational')], today).mixNote, null);
    const varied = buildCalendar([idea('a', '2026-10-18', 'Educational'), idea('b', '2026-10-19', 'Promotional'), idea('c', '2026-10-20', 'Community')], today);
    assert.equal(varied.mixNote, null);
  });

  it('mentions ideas with no mix when the rest are set', () => {
    const cal = buildCalendar([idea('a', '2026-10-18', 'Educational'), idea('b', '2026-10-19', 'Promotional'), idea('c', '2026-10-20', null)], today);
    assert.match(cal.mixNote ?? '', /1 upcoming idea has no content mix set/);
  });
});
