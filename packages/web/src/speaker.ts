// SPDX-License-Identifier: AGPL-3.0-or-later
// Text-to-speech adapter around the browser's speechSynthesis, hardened for the ways it
// misbehaves: speak() can throw, "end" sometimes never fires (so a timeout ends the
// reading), "error" fires on cancel. A recording, when there is one, is played instead.

import { speechTimeoutMs, type VoiceInfo } from '@dictalark/core';

export type SpeakOutcome = 'ended' | 'timeout' | 'error' | 'cancelled';

export interface SynthLike {
  speak(u: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceInfo[];
}
export interface UtteranceLike {
  text: string;
  lang: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
}

export interface Timers {
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export interface Speaker {
  speak(
    text: string,
    lang: string,
    voice: VoiceInfo | undefined,
    rate: number,
  ): Promise<SpeakOutcome>;
  cancel(): void;
}

export function createSpeaker(
  synth: SynthLike,
  makeUtterance: (text: string) => UtteranceLike,
  timers: Timers,
  /** Map our voice description back to the browser's voice object. */
  resolveVoice: (v: VoiceInfo) => unknown = (v) => v,
): Speaker {
  let finishCurrent: ((o: SpeakOutcome) => void) | undefined;
  return {
    speak(text, lang, voice, rate) {
      finishCurrent?.('cancelled');
      return new Promise<SpeakOutcome>((resolve) => {
        let settled = false;
        let timer: unknown = undefined;
        const finish = (o: SpeakOutcome) => {
          if (settled) return;
          settled = true;
          timers.clearTimeout(timer);
          if (finishCurrent === finish) finishCurrent = undefined;
          resolve(o);
        };
        finishCurrent = finish;
        const u = makeUtterance(text);
        u.lang = voice?.lang ?? lang;
        u.rate = Math.min(2, Math.max(0.5, Number.isFinite(rate) ? rate : 1));
        if (voice) u.voice = resolveVoice(voice);
        u.onend = () => finish('ended');
        u.onerror = (e) =>
          finish(e?.error === 'interrupted' || e?.error === 'canceled' ? 'cancelled' : 'error');
        timer = timers.setTimeout(
          () => {
            // Settle first: cancelling makes some browsers fire "error: interrupted" at once.
            finish('timeout');
            try {
              synth.cancel();
            } catch {
              /* ignore */
            }
          },
          speechTimeoutMs(text, u.rate),
        );
        try {
          synth.speak(u);
        } catch {
          finish('error');
        }
      });
    },
    cancel() {
      const f = finishCurrent;
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      f?.('cancelled');
    },
  };
}
