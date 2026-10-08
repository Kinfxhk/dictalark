// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the pure player from @dictalark/core in the browser: a 200 ms clock, and "speak"
// effects carried out with the parent's recording, a device voice, or (with neither) a
// button the parent presses after reading the word aloud.

import {
  initialState,
  parsePunctuationNames,
  pickVoice,
  speakPunctuation,
  type VoiceChoice,
  step,
  type Item,
  type PlayerConfig,
  type PlayerEvent,
  type PlayerState,
} from '@dictalark/core';
import { app, recKey } from './app';
import { listVoices, playRecording, speaker, stopAudio } from './env';

export interface SessionItem {
  listId: string;
  item: Item;
  lang: string;
  /** Passage mode: the part of the item read in this step (default: the whole item). */
  speak?: string;
  /** Passage mode: which part this is, 0-based, of how many. */
  part?: { i: number; n: number };
  /** Passage mode: index of the item this step belongs to. */
  itemIndex?: number;
}

export type Source = 'recording' | 'voice' | 'manual';

export interface SessionView {
  state: PlayerState;
  /** How the current item is being read (while speaking). */
  source: Source | undefined;
}

export interface Session {
  dispatch(e: PlayerEvent): void;
  /** The parent has read the current word aloud (no recording, no voice). */
  readDone(): void;
  readonly view: SessionView;
  dispose(): void;
}

export const TICK_MS = 200;

/** The device voice for `lang`, honouring the voices chosen on the voices page. */
export function chooseVoice(lang: string): VoiceChoice {
  return pickVoice(listVoices(), lang, {
    allowRemote: app.settings.allowRemoteVoices,
    preferredNames: app.settings.preferredVoices,
  });
}

/** What the voice says for an item: its spoken text if set, otherwise the word itself. */
export const spokenText = (s: SessionItem): string => s.speak ?? s.item.say ?? s.item.text;

/** Custom punctuation names from settings (a bad entry is ignored here; the form checks). */
export function punctuationOverrides(): Record<string, string> {
  try {
    return parsePunctuationNames(app.settings.punctNames);
  } catch {
    return {};
  }
}

export function sourceFor(s: SessionItem): Source {
  if (app.recordings.has(recKey(s.listId, s.item.id))) return 'recording';
  return chooseVoice(s.lang).voice ? 'voice' : 'manual';
}

/** Read one item aloud outside a dictation (flash cards). */
export async function readAloud(s: SessionItem): Promise<Source> {
  const source = sourceFor(s);
  stopAudio();
  speaker.cancel();
  if (source === 'recording') {
    const rec = await app.store.getRecording(recKey(s.listId, s.item.id)).catch(() => undefined);
    if (rec) await playRecording(rec);
  } else if (source === 'voice') {
    const choice = chooseVoice(s.lang);
    await speaker.speak(
      spokenText(s),
      choice.voice?.lang ?? s.lang,
      choice.voice,
      app.settings.rate,
    );
  }
  return source;
}

export function createSession(
  items: readonly SessionItem[],
  cfg: PlayerConfig,
  onChange: (v: SessionView) => void,
  onDone: () => void,
): Session {
  const view: SessionView = {
    state: initialState(items.map((_, i) => String(i))),
    source: undefined,
  };
  // Every speak gets a token; an outcome for an older token (late "end" event) is ignored.
  let token = 0;
  let last = performance.now();
  let disposed = false;

  const speakItem = async (index: number, my: number) => {
    const s = items[index]!;
    const source = sourceFor(s);
    view.source = source;
    onChange(view);
    if (source === 'manual') return; // waits for readDone()
    let outcome: string;
    if (source === 'recording') {
      const rec = await app.store.getRecording(recKey(s.listId, s.item.id)).catch(() => undefined);
      if (my !== token) return;
      outcome = rec ? await playRecording(rec) : 'error';
    } else {
      const choice = chooseVoice(s.lang);
      const text = app.settings.readPunctuation
        ? speakPunctuation(spokenText(s), s.lang, punctuationOverrides())
        : spokenText(s);
      outcome = await speaker.speak(
        text,
        choice.voice?.lang ?? s.lang,
        choice.voice,
        app.settings.rate,
      );
    }
    if (my !== token || disposed || outcome === 'cancelled') return;
    dispatch({ type: 'spoken' });
  };

  function dispatch(e: PlayerEvent): void {
    if (disposed) return;
    const r = step(view.state, e, cfg);
    view.state = r.state;
    if (r.state.phase !== 'speaking') view.source = undefined;
    for (const fx of r.effects) {
      if (fx.type === 'cancel') {
        token++;
        speaker.cancel();
        stopAudio();
      } else if (fx.type === 'speak') {
        const my = ++token;
        void speakItem(fx.index, my);
      } else if (fx.type === 'done') {
        stop();
        onChange(view);
        onDone();
        return;
      }
    }
    onChange(view);
  }

  const timer = setInterval(() => {
    const now = performance.now();
    const ms = now - last;
    last = now;
    const p = view.state.phase;
    if (p === 'countdown' || p === 'waiting') dispatch({ type: 'tick', ms });
  }, TICK_MS);

  function stop() {
    clearInterval(timer);
  }

  return {
    dispatch,
    readDone() {
      if (view.state.phase === 'speaking' && view.source === 'manual') {
        token++;
        dispatch({ type: 'spoken' });
      }
    },
    get view() {
      return view;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      token++;
      stop();
      speaker.cancel();
      stopAudio();
    },
  };
}
