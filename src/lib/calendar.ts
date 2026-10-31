import { plural } from './format';
import type { Idea } from './types';

type CalendarIdea = Pick<Idea, 'id' | 'hook' | 'platform' | 'format' | 'content_mix' | 'scheduled_for' | 'status'>;

export type CalendarDay<T extends CalendarIdea = CalendarIdea> = { date: string; items: T[] };

export type EditorialCalendar<T extends CalendarIdea = CalendarIdea> = {
  /** Planned ideas whose date is today or later, grouped by date, soonest first. */
  upcoming: CalendarDay<T>[];
  /** Planned ideas whose date has passed without being marked posted. */
  slipped: CalendarDay<T>[];
  /** Content mix across upcoming ideas. "Not set" counts ideas with no mix. */
  mix: Array<{ mix: string; count: number }>;
  /** A plain observation about the mix, or null when there is nothing worth saying. */
  mixNote: string | null;
  upcomingCount: number;
};

export const MIX_NOT_SET = 'Not set';

function groupByDate<T extends CalendarIdea>(items: T[], order: 'asc' | 'desc'): CalendarDay<T>[] {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const date = item.scheduled_for as string;
    map.set(date, [...(map.get(date) ?? []), item]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (order === 'asc' ? a.localeCompare(b) : b.localeCompare(a)))
    .map(([date, list]) => ({ date, items: list }));
}

/**
 * Editorial calendar from the creator's own scheduled ideas. Posted and measured ideas are history,
 * so they are left out. `today` is a YYYY-MM-DD string so the result does not depend on a time zone.
 */
export function buildCalendar<T extends CalendarIdea>(ideas: T[], today: string): EditorialCalendar<T> {
  const planned = ideas.filter((i) => i.scheduled_for && i.status !== 'posted' && i.status !== 'measured');
  const upcomingItems = planned.filter((i) => (i.scheduled_for as string) >= today);
  const slippedItems = planned.filter((i) => (i.scheduled_for as string) < today);

  const counts = new Map<string, number>();
  for (const i of upcomingItems) {
    const key = i.content_mix?.trim() || MIX_NOT_SET;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const mix = Array.from(counts.entries())
    .map(([m, count]) => ({ mix: m, count }))
    .sort((a, b) => b.count - a.count || a.mix.localeCompare(b.mix));

  let mixNote: string | null = null;
  if (upcomingItems.length >= 3) {
    if (mix.length === 1) {
      mixNote =
        mix[0].mix === MIX_NOT_SET
          ? `None of your ${upcomingItems.length} upcoming ideas has a content mix set, so PBOS cannot check the balance. Set one on each idea.`
          : `All ${upcomingItems.length} upcoming ideas are ${mix[0].mix}. Consider scheduling a different content mix.`;
    } else {
      const unset = counts.get(MIX_NOT_SET) ?? 0;
      if (unset > 0) mixNote = `${plural(unset, 'upcoming idea')} ${unset === 1 ? 'has' : 'have'} no content mix set.`;
    }
  }

  return {
    upcoming: groupByDate(upcomingItems, 'asc'),
    slipped: groupByDate(slippedItems, 'desc'),
    mix,
    mixNote,
    upcomingCount: upcomingItems.length,
  };
}
