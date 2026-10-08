// SPDX-License-Identifier: AGPL-3.0-or-later
// Dictation player as a pure state machine. The UI feeds it events (button presses, "the
// voice finished", clock ticks) and carries out the effects it returns (speak item k,
// cancel speech, finished). Speech and timers are adapters outside the core, so every
// sequence of events can be tested without a browser.

import { DictalarkError } from '../model/errors';

export interface PlayerConfig {
  /** Readings per item, 1–5. */
  repeats: number;
  /** Seconds between readings of the same item, 0–20. */
  gapSeconds: number;
  /** Seconds between items, 0–60. */
  itemGapSeconds: number;
  /** Seconds of countdown before the first item, 0–10. */
  countdownSeconds: number;
}

export const DEFAULT_PLAYER: Readonly<PlayerConfig> = Object.freeze({
  repeats: 2,
  gapSeconds: 3,
  itemGapSeconds: 8,
  countdownSeconds: 3,
});

export function validatePlayerConfig(c: PlayerConfig): PlayerConfig {
  const ok = (v: number, lo: number, hi: number) => Number.isInteger(v) && v >= lo && v <= hi;
  if (
    !ok(c.repeats, 1, 5) ||
    !ok(c.gapSeconds, 0, 20) ||
    !ok(c.itemGapSeconds, 0, 60) ||
    !ok(c.countdownSeconds, 0, 10)
  )
    throw new DictalarkError('bad-shape', {
      path: 'player',
      expected: 'repeats 1–5, gaps 0–20 / 0–60 s, countdown 0–10 s (whole numbers)',
    });
  return { ...c };
}

export type Phase = 'idle' | 'countdown' | 'speaking' | 'waiting' | 'paused' | 'done';

export interface PlayerState {
  phase: Phase;
  /** Item ids in play order. */
  order: readonly string[];
  index: number;
  /** Readings of the current item completed so far. */
  readings: number;
  /** Milliseconds left in countdown / waiting. */
  remainingMs: number;
  /** Phase to return to when resumed. */
  resumeTo?: 'countdown' | 'speaking' | 'waiting' | undefined;
}

export type PlayerEvent =
  | { type: 'start' }
  | { type: 'spoken' }
  | { type: 'tick'; ms: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'repeat' }
  | { type: 'stop' }
  | { type: 'items'; order: readonly string[] };

export type Effect =
  | { type: 'speak'; itemId: string; index: number; reading: number }
  | { type: 'cancel' }
  | { type: 'done' };

export interface Step {
  state: PlayerState;
  effects: Effect[];
}

export function initialState(order: readonly string[]): PlayerState {
  return { phase: 'idle', order: [...order], index: 0, readings: 0, remainingMs: 0 };
}

const speak = (s: PlayerState, index: number, readings: number, pre: Effect[] = []): Step => ({
  state: { ...s, phase: 'speaking', index, readings, remainingMs: 0, resumeTo: undefined },
  effects: [...pre, { type: 'speak', itemId: s.order[index]!, index, reading: readings + 1 }],
});

const finish = (s: PlayerState, pre: Effect[] = []): Step => ({
  state: { ...s, phase: 'done', remainingMs: 0, resumeTo: undefined },
  effects: [...pre, { type: 'done' }],
});

/** Start item `index` (or finish when there is none). */
const goTo = (s: PlayerState, index: number, pre: Effect[] = []): Step =>
  index >= 0 && index < s.order.length ? speak(s, index, 0, pre) : finish(s, pre);

/** After a wait has run out (or was zero): read again or move on. */
function afterWait(s: PlayerState, cfg: PlayerConfig): Step {
  if (s.readings < cfg.repeats) return speak(s, s.index, s.readings);
  return goTo(s, s.index + 1);
}

function wait(s: PlayerState, cfg: PlayerConfig, ms: number): Step {
  if (ms <= 0) return afterWait(s, cfg);
  return { state: { ...s, phase: 'waiting', remainingMs: ms }, effects: [] };
}

export function step(s: PlayerState, e: PlayerEvent, cfg: PlayerConfig): Step {
  const same: Step = { state: s, effects: [] };
  const active = s.phase !== 'idle' && s.phase !== 'done';
  switch (e.type) {
    case 'start':
      if (s.phase !== 'idle') return same;
      if (s.order.length === 0) return finish(s);
      if (cfg.countdownSeconds > 0)
        return {
          state: { ...s, phase: 'countdown', remainingMs: cfg.countdownSeconds * 1000 },
          effects: [],
        };
      return speak(s, 0, 0);
    case 'spoken': {
      if (s.phase !== 'speaking') return same; // late or duplicate "end" from the voice
      const done = { ...s, readings: s.readings + 1 };
      if (done.readings < cfg.repeats) return wait(done, cfg, cfg.gapSeconds * 1000);
      // The last word gets its writing time too (v0.3); "next" or Enter ends it early.
      return wait(done, cfg, cfg.itemGapSeconds * 1000);
    }
    case 'tick': {
      if (!(e.ms >= 0) || !Number.isFinite(e.ms)) return same;
      if (s.phase !== 'countdown' && s.phase !== 'waiting') return same;
      const left = s.remainingMs - e.ms;
      if (left > 0) return { state: { ...s, remainingMs: left }, effects: [] };
      return s.phase === 'countdown' ? speak(s, 0, 0) : afterWait({ ...s, remainingMs: 0 }, cfg);
    }
    case 'pause':
      if (s.phase !== 'countdown' && s.phase !== 'speaking' && s.phase !== 'waiting') return same;
      return {
        state: { ...s, phase: 'paused', resumeTo: s.phase },
        effects: s.phase === 'speaking' ? [{ type: 'cancel' }] : [],
      };
    case 'resume':
      if (s.phase !== 'paused') return same;
      // An interrupted reading is read again from the start (it does not count twice).
      if (s.resumeTo === 'speaking') return speak(s, s.index, s.readings);
      return { state: { ...s, phase: s.resumeTo ?? 'waiting', resumeTo: undefined }, effects: [] };
    case 'next':
      if (!active) return same;
      return goTo(s, s.index + 1, s.phase === 'speaking' ? [{ type: 'cancel' }] : []);
    case 'prev':
      if (!active) return same;
      return goTo(s, Math.max(0, s.index - 1), s.phase === 'speaking' ? [{ type: 'cancel' }] : []);
    case 'repeat':
      // Read the current item again from its first reading.
      if (!active) return same;
      return speak(s, s.index, 0, s.phase === 'speaking' ? [{ type: 'cancel' }] : []);
    case 'stop':
      if (!active) return same;
      return finish(s, s.phase === 'speaking' ? [{ type: 'cancel' }] : []);
    case 'items': {
      // The list changed during play (e.g. an item was deleted). Keep the current item if
      // it still exists; otherwise continue with whatever is now at the same position.
      const order = [...e.order];
      const current = s.order[s.index];
      const kept = current === undefined ? -1 : order.indexOf(current);
      const t: PlayerState = { ...s, order };
      if (!active) return { state: { ...t, index: 0, readings: 0 }, effects: [] };
      if (kept >= 0) return { state: { ...t, index: kept }, effects: [] };
      const pre: Effect[] = s.phase === 'speaking' ? [{ type: 'cancel' }] : [];
      if (s.phase === 'paused') {
        if (s.index >= order.length) return finish(t, pre);
        return { state: { ...t, readings: 0, resumeTo: 'speaking' }, effects: [] };
      }
      return goTo({ ...t, readings: 0 }, s.index, pre);
    }
  }
}

/** Total time of an uninterrupted dictation, excluding the readings themselves. */
export function silentMs(n: number, cfg: PlayerConfig): number {
  if (n === 0) return 0;
  return (
    cfg.countdownSeconds * 1000 +
    n * (cfg.repeats - 1) * cfg.gapSeconds * 1000 +
    n * cfg.itemGapSeconds * 1000
  );
}
