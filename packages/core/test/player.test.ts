// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAYER,
  initialState,
  silentMs,
  step,
  validatePlayerConfig,
  type Effect,
  type PlayerConfig,
  type PlayerEvent,
  type PlayerState,
} from '../src/index';
import { ReferencePlayer } from '../../../test/oracle/player-model';

const cfg = (over: Partial<PlayerConfig> = {}): PlayerConfig => ({ ...DEFAULT_PLAYER, ...over });

function runAll(order: string[], c: PlayerConfig, events: PlayerEvent[]) {
  let s = initialState(order);
  const log: Effect[] = [];
  for (const e of events) {
    const r = step(s, e, c);
    s = r.state;
    log.push(...r.effects);
  }
  return { s, log };
}

/** Drive a whole dictation: answer every "speak" with "spoken", tick the clock in 250 ms. */
function drive(order: string[], c: PlayerConfig, readMs = 0) {
  let s: PlayerState = initialState(order);
  const spoken: string[] = [];
  let silent = 0;
  let r = step(s, { type: 'start' }, c);
  for (let guard = 0; guard < 100_000; guard++) {
    s = r.state;
    if (r.effects.some((e) => e.type === 'done')) break;
    const sp = r.effects.find((e) => e.type === 'speak');
    if (sp && sp.type === 'speak') {
      spoken.push(`${sp.itemId}#${sp.reading}`);
      void readMs;
      r = step(s, { type: 'spoken' }, c);
      continue;
    }
    silent += 250;
    r = step(s, { type: 'tick', ms: 250 }, c);
  }
  return { s, spoken, silent };
}

describe('player (examples)', () => {
  it('reads every item `repeats` times, in order, with the configured pauses', () => {
    const c = cfg({ repeats: 3, gapSeconds: 2, itemGapSeconds: 5, countdownSeconds: 3 });
    const r = drive(['a', 'b'], c);
    expect(r.spoken).toEqual(['a#1', 'a#2', 'a#3', 'b#1', 'b#2', 'b#3']);
    expect(r.silent).toBe(silentMs(2, c));
    // the last word gets its writing time too (v0.3)
    expect(r.silent).toBe(3000 + 2 * 2 * 2000 + 2 * 5000);
    expect(r.s.phase).toBe('done');
  });
  it('after the last reading it waits the pause between words; "next" ends it at once', () => {
    const c = cfg({ repeats: 1, gapSeconds: 0, itemGapSeconds: 5, countdownSeconds: 0 });
    let r = step(initialState(['a']), { type: 'start' }, c);
    r = step(r.state, { type: 'spoken' }, c);
    expect(r.state.phase).toBe('waiting');
    expect(r.state.remainingMs).toBe(5000);
    expect(r.effects).toEqual([]);
    const next = step(r.state, { type: 'next' }, c);
    expect(next.state.phase).toBe('done');
    expect(next.effects).toEqual([{ type: 'done' }]);
    const zero = cfg({ repeats: 1, gapSeconds: 0, itemGapSeconds: 0, countdownSeconds: 0 });
    const z = step(
      step(initialState(['a']), { type: 'start' }, zero).state,
      { type: 'spoken' },
      zero,
    );
    expect(z.state.phase).toBe('done');
  });
  it('0 items: start finishes at once', () => {
    expect(runAll([], cfg(), [{ type: 'start' }]).log).toEqual([{ type: 'done' }]);
  });
  it('1 item, 1 reading, no countdown, no pauses', () => {
    const c = cfg({ repeats: 1, gapSeconds: 0, itemGapSeconds: 0, countdownSeconds: 0 });
    const r = drive(['x'], c);
    expect(r.spoken).toEqual(['x#1']);
    expect(r.silent).toBe(0);
  });
  it('pause 0 seconds moves straight on', () => {
    const c = cfg({ repeats: 2, gapSeconds: 0, itemGapSeconds: 0, countdownSeconds: 0 });
    expect(drive(['a', 'b'], c)).toMatchObject({ spoken: ['a#1', 'a#2', 'b#1', 'b#2'], silent: 0 });
  });
  it('repeats 0 (and other out-of-range settings) are refused', () => {
    for (const bad of [
      { repeats: 0 },
      { repeats: 6 },
      { gapSeconds: 21 },
      { gapSeconds: -1 },
      { itemGapSeconds: 61 },
      { countdownSeconds: 11 },
      { repeats: 1.5 },
    ])
      expect(() => validatePlayerConfig(cfg(bad))).toThrow();
    expect(validatePlayerConfig(cfg())).toEqual(cfg());
  });
  it('pause while speaking cancels the voice; resume reads the same reading again', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a', 'b'], c, [{ type: 'start' }, { type: 'pause' }, { type: 'resume' }]);
    expect(r.log).toEqual([
      { type: 'speak', itemId: 'a', index: 0, reading: 1 },
      { type: 'cancel' },
      { type: 'speak', itemId: 'a', index: 0, reading: 1 },
    ]);
  });
  it('a late "spoken" after pause is ignored', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a'], c, [{ type: 'start' }, { type: 'pause' }, { type: 'spoken' }]);
    expect(r.s.phase).toBe('paused');
    expect(r.s.readings).toBe(0);
  });
  it('pause keeps the remaining wait', () => {
    const c = cfg({ countdownSeconds: 0, gapSeconds: 4 });
    const r = runAll(['a'], c, [
      { type: 'start' },
      { type: 'spoken' },
      { type: 'tick', ms: 1500 },
      { type: 'pause' },
      { type: 'tick', ms: 10_000 },
      { type: 'resume' },
    ]);
    expect(r.s).toMatchObject({ phase: 'waiting', remainingMs: 2500 });
  });
  it('next, prev and repeat jump and cancel the voice', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a', 'b', 'c'], c, [
      { type: 'start' },
      { type: 'next' },
      { type: 'next' },
      { type: 'prev' },
      { type: 'repeat' },
      { type: 'next' },
      { type: 'next' },
    ]);
    const speaks = r.log
      .filter((e) => e.type === 'speak')
      .map((e) => e.type === 'speak' && e.itemId);
    expect(speaks).toEqual(['a', 'b', 'c', 'b', 'b', 'c']);
    expect(r.s.phase).toBe('done');
  });
  it('deleting the item being read moves on to the item now in its place', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a', 'b', 'c'], c, [
      { type: 'start' },
      { type: 'next' },
      { type: 'items', order: ['a', 'c'] },
    ]);
    expect(r.log.slice(-2)).toEqual([
      { type: 'cancel' },
      { type: 'speak', itemId: 'c', index: 1, reading: 1 },
    ]);
  });
  it('deleting another item keeps the current one (index follows it)', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a', 'b', 'c'], c, [
      { type: 'start' },
      { type: 'next' },
      { type: 'items', order: ['b', 'c'] },
    ]);
    expect(r.s).toMatchObject({ index: 0, phase: 'speaking' });
    expect(r.s.order[r.s.index]).toBe('b');
  });
  it('deleting the last item while it is read finishes', () => {
    const c = cfg({ countdownSeconds: 0 });
    const r = runAll(['a', 'b'], c, [
      { type: 'start' },
      { type: 'next' },
      { type: 'items', order: ['a'] },
    ]);
    expect(r.s.phase).toBe('done');
  });
  it('ignores negative, NaN and infinite ticks', () => {
    const c = cfg();
    const r = runAll(['a'], c, [
      { type: 'start' },
      { type: 'tick', ms: -5000 },
      { type: 'tick', ms: Number.NaN },
      { type: 'tick', ms: Number.POSITIVE_INFINITY },
    ]);
    expect(r.s).toMatchObject({ phase: 'countdown', remainingMs: 3000 });
  });
});

const eventArb: fc.Arbitrary<PlayerEvent> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<PlayerEvent>({ type: 'spoken' }) },
  {
    weight: 4,
    arbitrary: fc.integer({ min: 0, max: 9000 }).map<PlayerEvent>((ms) => ({ type: 'tick', ms })),
  },
  fc.constantFrom<PlayerEvent>(
    { type: 'start' },
    { type: 'pause' },
    { type: 'resume' },
    { type: 'next' },
    { type: 'prev' },
    { type: 'repeat' },
    { type: 'stop' },
  ),
  fc.subarray(['a', 'b', 'c', 'd', 'e']).map<PlayerEvent>((order) => ({ type: 'items', order })),
);
const cfgArb = fc.record({
  repeats: fc.integer({ min: 1, max: 5 }),
  gapSeconds: fc.integer({ min: 0, max: 20 }),
  itemGapSeconds: fc.integer({ min: 0, max: 60 }),
  countdownSeconds: fc.integer({ min: 0, max: 10 }),
});

describe('player (model-based, 2,000 random event sequences)', () => {
  it('matches the reference model in every effect, phase, item, reading count and wait', () => {
    fc.assert(
      fc.property(
        fc.subarray(['a', 'b', 'c', 'd', 'e']),
        cfgArb,
        fc.array(eventArb, { maxLength: 60 }),
        (order, c, events) => {
          const model = new ReferencePlayer(order, c);
          let s = initialState(order);
          const log: Effect[] = [];
          for (const e of events) {
            const r = step(s, e, c);
            s = r.state;
            log.push(...r.effects);
            model.send(e);
            expect(log).toEqual(model.log);
            expect({
              phase: s.phase,
              order: s.order,
              index: s.index,
              readings: s.readings,
              remainingMs: s.remainingMs,
            }).toEqual({
              phase: model.phase,
              order: model.order,
              index: model.index,
              readings: model.readings,
              remainingMs: model.remainingMs,
            });
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('uninterrupted runs read each item exactly `repeats` times and wait exactly silentMs', () => {
    fc.assert(
      fc.property(fc.subarray(['a', 'b', 'c', 'd', 'e'], { minLength: 0 }), cfgArb, (order, c) => {
        const r = drive(order, c);
        expect(r.spoken).toEqual(
          order.flatMap((id) => Array.from({ length: c.repeats }, (_, k) => `${id}#${k + 1}`)),
        );
        // Ticks are 250 ms and every configured pause is a whole number of seconds.
        expect(r.silent).toBe(silentMs(order.length, c));
      }),
      { numRuns: 500 },
    );
  });
});

// v0.2: controls must always win over a reading in progress (competitor reviews report
// "stop keeps reading" and "next does nothing"). Invariants checked on random sequences.
describe('player controls during a reading (v0.2 regression, 2,000 sequences)', () => {
  it('stop, next, prev, repeat and pause always cancel a reading in progress', () => {
    fc.assert(
      fc.property(
        fc.subarray(['a', 'b', 'c', 'd', 'e'], { minLength: 1 }),
        cfgArb,
        fc.array(eventArb, { maxLength: 40 }),
        fc.constantFrom<PlayerEvent['type']>('stop', 'next', 'prev', 'repeat', 'pause'),
        (order, c, events, control) => {
          let s = initialState(order);
          for (const e of events) s = step(s, e, c).state;
          if (s.phase !== 'speaking') return;
          const r = step(s, { type: control } as PlayerEvent, c);
          expect(r.effects[0]).toEqual({ type: 'cancel' });
          if (control === 'stop') expect(r.state.phase).toBe('done');
          if (control === 'pause') expect(r.state.phase).toBe('paused');
          if (control === 'next') {
            if (s.index + 1 < s.order.length)
              expect(r.state).toMatchObject({ phase: 'speaking', index: s.index + 1, readings: 0 });
            else expect(r.state.phase).toBe('done');
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('after stop nothing is ever read again, whatever happens next', () => {
    fc.assert(
      fc.property(
        fc.subarray(['a', 'b', 'c'], { minLength: 1 }),
        cfgArb,
        fc.array(eventArb, { maxLength: 30 }),
        fc.array(eventArb, { maxLength: 30 }),
        (order, c, before, after) => {
          let s = step(initialState(order), { type: 'start' }, c).state;
          for (const e of before) s = step(s, e, c).state;
          s = step(s, { type: 'stop' }, c).state;
          expect(['done', 'idle']).toContain(s.phase);
          for (const e of after) {
            const r = step(s, e, c);
            s = r.state;
            expect(r.effects.filter((x) => x.type === 'speak')).toEqual([]);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('a paused dictation never reads on its own (ticks and late "end" events)', () => {
    fc.assert(
      fc.property(
        fc.subarray(['a', 'b', 'c'], { minLength: 1 }),
        cfgArb,
        fc.array(eventArb, { maxLength: 30 }),
        fc.array(
          fc.oneof(
            fc.constant<PlayerEvent>({ type: 'spoken' }),
            fc.integer({ min: 0, max: 90_000 }).map<PlayerEvent>((ms) => ({ type: 'tick', ms })),
          ),
          { maxLength: 30 },
        ),
        (order, c, before, idle) => {
          let s = step(initialState(order), { type: 'start' }, c).state;
          for (const e of before) s = step(s, e, c).state;
          if (s.phase === 'done' || s.phase === 'idle') return;
          s = step(s, { type: 'pause' }, c).state;
          expect(s.phase).toBe('paused');
          for (const e of idle) {
            const r = step(s, e, c);
            expect(r.effects).toEqual([]);
            expect(r.state).toEqual(s);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });
});
