// SPDX-License-Identifier: AGPL-3.0-or-later
// Reference model of the dictation player, written as a plain imperative object with a
// timeline, independently of packages/core/src/player (which is a pure reducer). The
// model-based test feeds both the same random events and compares everything observable.

import type { Effect, PlayerConfig, PlayerEvent } from '../../packages/core/src/index';

export class ReferencePlayer {
  phase = 'idle';
  order: string[];
  index = 0;
  readings = 0;
  remainingMs = 0;
  private before: string | undefined;
  log: Effect[] = [];

  constructor(
    order: readonly string[],
    private cfg: PlayerConfig,
  ) {
    this.order = [...order];
  }

  private say() {
    this.phase = 'speaking';
    this.remainingMs = 0;
    this.before = undefined;
    this.log.push({
      type: 'speak',
      itemId: this.order[this.index]!,
      index: this.index,
      reading: this.readings + 1,
    });
  }
  private end() {
    this.phase = 'done';
    this.remainingMs = 0;
    this.before = undefined;
    this.log.push({ type: 'done' });
  }
  private cancelIfSpeaking() {
    if (this.phase === 'speaking') this.log.push({ type: 'cancel' });
  }
  private jump(to: number) {
    this.cancelIfSpeaking();
    if (to < 0 || to >= this.order.length) return this.end();
    this.index = to;
    this.readings = 0;
    this.say();
  }
  private continueAfterWait() {
    if (this.readings < this.cfg.repeats) this.say();
    else if (this.index + 1 < this.order.length) {
      this.index++;
      this.readings = 0;
      this.say();
    } else this.end();
  }
  private live() {
    return this.phase !== 'idle' && this.phase !== 'done';
  }

  send(e: PlayerEvent): void {
    if (e.type === 'start') {
      if (this.phase !== 'idle') return;
      if (!this.order.length) return this.end();
      if (this.cfg.countdownSeconds) {
        this.phase = 'countdown';
        this.remainingMs = this.cfg.countdownSeconds * 1000;
      } else this.say();
    } else if (e.type === 'spoken') {
      if (this.phase !== 'speaking') return;
      this.readings++;
      const lastReading = this.readings >= this.cfg.repeats;
      const pause = (lastReading ? this.cfg.itemGapSeconds : this.cfg.gapSeconds) * 1000;
      if (pause === 0) return this.continueAfterWait();
      this.phase = 'waiting';
      this.remainingMs = pause;
    } else if (e.type === 'tick') {
      if (this.phase !== 'countdown' && this.phase !== 'waiting') return;
      if (!(e.ms >= 0) || !Number.isFinite(e.ms)) return;
      this.remainingMs -= e.ms;
      if (this.remainingMs > 0) return;
      this.remainingMs = 0;
      if (this.phase === 'countdown') {
        this.index = 0;
        this.readings = 0;
        this.say();
      } else this.continueAfterWait();
    } else if (e.type === 'pause') {
      if (!['countdown', 'speaking', 'waiting'].includes(this.phase)) return;
      this.cancelIfSpeaking();
      this.before = this.phase;
      this.phase = 'paused';
    } else if (e.type === 'resume') {
      if (this.phase !== 'paused') return;
      if (this.before === 'speaking') return this.say();
      this.phase = this.before ?? 'waiting';
      this.before = undefined;
    } else if (e.type === 'next') {
      if (this.live()) this.jump(this.index + 1);
    } else if (e.type === 'prev') {
      if (this.live()) this.jump(Math.max(0, this.index - 1));
    } else if (e.type === 'repeat') {
      if (this.live()) this.jump(this.index);
    } else if (e.type === 'stop') {
      if (!this.live()) return;
      this.cancelIfSpeaking();
      this.end();
    } else if (e.type === 'items') {
      const cur = this.order[this.index];
      this.order = [...e.order];
      if (!this.live()) {
        this.index = 0;
        this.readings = 0;
        return;
      }
      const at = cur === undefined ? -1 : this.order.indexOf(cur);
      if (at >= 0) {
        this.index = at;
        return;
      }
      this.readings = 0;
      if (this.phase === 'paused') {
        if (this.index >= this.order.length) {
          this.end();
          return;
        }
        this.before = 'speaking';
        return;
      }
      this.jump(this.index);
    }
  }
}
