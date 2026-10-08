// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  below,
  DEFAULT_INTERVALS,
  daysBetween,
  dueKeys,
  localDay,
  MAX_SEED,
  nextCard,
  prng,
  shuffle,
  validateIntervals,
  validateSeed,
  type SrsCard,
} from '../src/index';
import { digest } from './helpers/tz-digest-lib';

const dayArb = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2999-12-01T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));
const cardArb: fc.Arbitrary<SrsCard | undefined> = fc.option(
  fc.record({ box: fc.constantFrom<SrsCard['box']>(1, 2, 3, 4, 5), due: dayArb }),
  { nil: undefined },
);
const resultArb = fc.constantFrom('right' as const, 'wrong' as const, 'blank' as const);

describe('spaced repetition', () => {
  it('golden: a word answered right climbs one box at a time, wrong goes back to box 1', () => {
    let c = nextCard(undefined, 'right', '2026-10-08');
    expect(c).toEqual({ box: 2, due: '2026-10-09' });
    c = nextCard(c, 'right', '2026-10-09');
    expect(c).toEqual({ box: 3, due: '2026-10-12' });
    c = nextCard(c, 'right', '2026-10-12');
    expect(c).toEqual({ box: 4, due: '2026-10-19' });
    c = nextCard(c, 'right', '2026-10-19');
    expect(c).toEqual({ box: 5, due: '2026-11-02' });
    c = nextCard(c, 'right', '2026-11-02');
    expect(c).toEqual({ box: 5, due: '2026-11-16' });
    c = nextCard(c, 'wrong', '2026-11-16');
    expect(c).toEqual({ box: 1, due: '2026-11-16' });
    expect(nextCard(c, 'blank', '2026-11-16')).toEqual({ box: 1, due: '2026-11-16' });
  });

  it('properties: box in 1–5, wrong → 1, right → at most one up, due ≥ today (5,000 runs)', () => {
    fc.assert(
      fc.property(cardArb, resultArb, dayArb, (card, result, today) => {
        const n = nextCard(card, result, today);
        expect(n.box).toBeGreaterThanOrEqual(1);
        expect(n.box).toBeLessThanOrEqual(5);
        if (result !== 'right') expect(n.box).toBe(1);
        else expect(n.box).toBe(Math.min(5, (card?.box ?? 1) + 1));
        expect(n.due >= today).toBe(true);
        expect(daysBetween(today, n.due)).toBe(DEFAULT_INTERVALS[n.box - 1]);
      }),
      { numRuns: 5000 },
    );
  });

  it('due dates never go backwards while every answer is right', () => {
    fc.assert(
      fc.property(
        dayArb,
        fc.array(fc.integer({ min: 0, max: 30 }), { maxLength: 12 }),
        (start, gaps) => {
          let day = start;
          let card: SrsCard | undefined;
          let lastDue = '0000-00-00';
          for (const g of gaps) {
            card = nextCard(card, 'right', day);
            expect(card.due >= lastDue).toBe(true);
            lastDue = card.due;
            day = addDays(day, g);
            if (day > '2999-01-01') break;
          }
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('calendar arithmetic is exact across DST changes, month ends and leap years', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29'); // UK clocks go forward
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25'); // UK clocks go back
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08'); // US clocks go forward
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-01', '2026-04-01')).toBe(31);
  });

  it('localDay uses the given zone, not the machine zone', () => {
    const t = Date.UTC(2026, 9, 7, 17, 30); // 2026-10-07 17:30 UTC
    expect(localDay(t, 'Asia/Hong_Kong')).toBe('2026-10-08');
    expect(localDay(t, 'America/New_York')).toBe('2026-10-07');
    expect(localDay(t, 'Europe/London')).toBe('2026-10-07');
    // Just after the UK spring-forward instant (01:00 UTC on 2026-03-29).
    expect(localDay(Date.UTC(2026, 2, 29, 0, 30), 'Europe/London')).toBe('2026-03-29');
    expect(localDay(Date.UTC(2026, 2, 28, 23, 30), 'Europe/London')).toBe('2026-03-28');
    // Just before and after the UK fall-back (01:00 UTC on 2026-10-25).
    expect(localDay(Date.UTC(2026, 9, 24, 23, 30), 'Europe/London')).toBe('2026-10-25');
    expect(localDay(Date.UTC(2026, 9, 24, 22, 30), 'Europe/London')).toBe('2026-10-24');
  });

  it('dueKeys lists overdue first and ignores future cards', () => {
    const srs: Record<string, SrsCard> = {
      'l/a': { box: 1, due: '2026-10-08' },
      'l/b': { box: 3, due: '2026-10-01' },
      'l/c': { box: 2, due: '2026-10-09' },
      'l/d': { box: 1, due: '2026-10-08' },
    };
    expect(dueKeys(srs, '2026-10-08')).toEqual(['l/b', 'l/a', 'l/d']);
  });

  it('intervals must be 5 non-decreasing whole days', () => {
    expect(validateIntervals([0, 1, 3, 7, 14])).toEqual([0, 1, 3, 7, 14]);
    for (const bad of [
      [0, 1, 3, 7],
      [0, 3, 1, 7, 14],
      [0, 1, 3, 7, 1.5],
      [-1, 1, 3, 7, 14],
      [0, 1, 3, 7, 400],
    ])
      expect(() => validateIntervals(bad)).toThrow();
  });

  it('gives identical results in every machine time zone (child processes)', () => {
    const script = fileURLToPath(new URL('./helpers/tz-digest.ts', import.meta.url));
    const run = (tz: string) =>
      execFileSync(process.execPath, ['--import', 'tsx', script], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      }).trim();
    const here = digest();
    for (const tz of [
      'America/New_York',
      'Europe/London',
      'Asia/Hong_Kong',
      'Pacific/Chatham',
      'UTC',
    ])
      expect(run(tz), tz).toBe(here);
  });
});

describe('seeded shuffle', () => {
  it('same seed → same order; result is always a permutation (2,000 runs)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer(), { maxLength: 40 }),
        fc.integer({ min: 0, max: MAX_SEED }),
        (xs, seed) => {
          const a = shuffle(xs, seed);
          expect(shuffle(xs, seed)).toEqual(a);
          expect([...a].sort((p, q) => p - q)).toEqual([...xs].sort((p, q) => p - q));
        },
      ),
      { numRuns: 2000 },
    );
  });
  it('does not change the input array', () => {
    const xs = [1, 2, 3];
    shuffle(xs, 5);
    expect(xs).toEqual([1, 2, 3]);
  });
  it.each([1, 2, 3, 4, 5, 6])('every one of the %i! orders can be produced by some seed', (n) => {
    const items = Array.from({ length: n }, (_, i) => i);
    const want = [1, 1, 2, 6, 24, 120, 720][n]!;
    const seen = new Set<string>();
    for (let seed = 0; seed <= MAX_SEED && seen.size < want; seed++)
      seen.add(shuffle(items, seed).join(','));
    expect(seen.size).toBe(want);
  });
  it('orders are roughly uniform (n = 3, 60,000 seeds, each within ±5%)', () => {
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 60_000; seed++) {
      const k = shuffle([0, 1, 2], seed).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const v of counts.values()) expect(Math.abs(v - 10_000)).toBeLessThan(500);
  });
  it('below() is unbiased by rejection and refuses bad ranges', () => {
    let calls = 0;
    const seq = [0xffffffff, 7];
    const fake = () => seq[calls++]!;
    expect(below(fake, 3)).toBe(1); // 0xffffffff is in the biased tail and is rejected
    expect(calls).toBe(2);
    expect(() => below(prng(1), 0)).toThrow();
  });
  it('seed must be a whole number in range', () => {
    expect(validateSeed(123)).toBe(123);
    for (const bad of [-1, MAX_SEED + 1, 1.5, '12', Number.NaN])
      expect(() => validateSeed(bad)).toThrow();
  });
});
