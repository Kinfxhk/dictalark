// SPDX-License-Identifier: AGPL-3.0-or-later
// Leitner boxes on local calendar days. Days are `YYYY-MM-DD` strings; arithmetic is done
// on the calendar (UTC noon-free integer days), never by adding milliseconds, so clock
// changes and the machine's time zone cannot shift a review.

import { DictalarkError } from '../model/errors';
import type { CalendarDay, ItemResult, SrsCard } from '../model/types';
import { validateDay } from '../model/validate';

export type Intervals = readonly [number, number, number, number, number];
/** Days until the next review for boxes 1–5. */
export const DEFAULT_INTERVALS: Intervals = [0, 1, 3, 7, 14];

export function validateIntervals(iv: readonly number[]): Intervals {
  if (
    iv.length !== 5 ||
    iv.some((d) => !Number.isInteger(d) || d < 0 || d > 365) ||
    iv.some((d, i) => i > 0 && d < iv[i - 1]!)
  )
    throw new DictalarkError('bad-shape', {
      path: 'intervals',
      expected: '5 whole days, 0–365, not decreasing',
    });
  return iv as unknown as Intervals;
}

const dayNumber = (day: CalendarDay): number => {
  validateDay(day, 'day');
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const fromDayNumber = (n: number): CalendarDay =>
  new Date(n * 86_400_000).toISOString().slice(0, 10);

export function addDays(day: CalendarDay, n: number): CalendarDay {
  return fromDayNumber(dayNumber(day) + n);
}

export function daysBetween(from: CalendarDay, to: CalendarDay): number {
  return dayNumber(to) - dayNumber(from);
}

/**
 * The calendar day of an instant in an IANA time zone (e.g. `Asia/Hong_Kong`). The UI
 * passes `Date.now()` and the browser's zone; tests pass fixed instants.
 */
export function localDay(epochMs: number, timeZone: string): CalendarDay {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Schedule after one answer. Wrong or blank → box 1; right → up one box (max 5). */
export function nextCard(
  card: SrsCard | undefined,
  result: ItemResult,
  today: CalendarDay,
  intervals: Intervals = DEFAULT_INTERVALS,
): SrsCard {
  const current = card?.box ?? 1;
  const box = (result === 'right' ? Math.min(5, current + 1) : 1) as SrsCard['box'];
  return { box, due: addDays(today, intervals[box - 1]!) };
}

/** Keys due on or before `today`, most overdue first, then by key for stability. */
export function dueKeys(srs: Readonly<Record<string, SrsCard>>, today: CalendarDay): string[] {
  return Object.entries(srs)
    .filter(([, c]) => c.due <= today)
    .sort(([ka, a], [kb, b]) =>
      a.due < b.due ? -1 : a.due > b.due ? 1 : ka < kb ? -1 : ka > kb ? 1 : 0,
    )
    .map(([k]) => k);
}
