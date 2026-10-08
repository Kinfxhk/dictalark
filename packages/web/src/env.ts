// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser wiring for the speech, recording and playback adapters.

import type { VoiceInfo } from '@dictalark/core';
import type { Recording } from './db';
import { startRecording, type ActiveRecording, type RecorderEnv } from './recorder';
import { createSpeaker, type Speaker, type UtteranceLike } from './speaker';

const synth: SpeechSynthesis | undefined =
  typeof speechSynthesis === 'undefined' ? undefined : speechSynthesis;

const toInfo = (v: SpeechSynthesisVoice): VoiceInfo => ({
  name: v.name,
  lang: v.lang,
  localService: v.localService,
  default: v.default,
  voiceURI: v.voiceURI,
});

export function listVoices(): VoiceInfo[] {
  try {
    return synth ? synth.getVoices().map(toInfo) : [];
  } catch {
    return [];
  }
}

/** Calls `cb` when the browser's voice list changes (voices often load late). */
export function onVoicesChanged(cb: () => void): void {
  synth?.addEventListener?.('voiceschanged', cb);
}

const realVoice = (v: VoiceInfo) =>
  synth?.getVoices().find((x) => x.voiceURI === v.voiceURI && x.name === v.name) ?? null;

export const speaker: Speaker = synth
  ? createSpeaker(
      {
        speak: (u) => synth.speak(u as unknown as SpeechSynthesisUtterance),
        cancel: () => synth.cancel(),
        getVoices: listVoices,
      },
      (text) => new SpeechSynthesisUtterance(text) as unknown as UtteranceLike,
      {
        setTimeout: (f, ms) => setTimeout(f, ms),
        clearTimeout: (id) => clearTimeout(id as number),
      },
      realVoice,
    )
  : {
      speak: async () => 'error' as const,
      cancel: () => {},
    };

export const hasSpeech = (): boolean => Boolean(synth);

const recorderEnv: RecorderEnv = {
  getUserMedia: (c) => {
    if (!navigator.mediaDevices?.getUserMedia)
      return Promise.reject(Object.assign(new Error('no media'), { name: 'NotFoundError' }));
    return navigator.mediaDevices.getUserMedia(c);
  },
  createRecorder: (stream, mime) =>
    new MediaRecorder(
      stream as MediaStream,
      mime ? { mimeType: mime } : undefined,
    ) as unknown as ReturnType<RecorderEnv['createRecorder']>,
  isTypeSupported: (m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m),
  now: () => performance.now(),
  setTimeout: (f, ms) => setTimeout(f, ms),
  clearTimeout: (id) => clearTimeout(id as number),
};

export const canRecord = (): boolean =>
  typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

export const record = (): Promise<ActiveRecording> => startRecording(recorderEnv);

let current: HTMLAudioElement | undefined;
let currentUrl: string | undefined;

/** Play a stored recording; resolves 'ended' or 'error' (or 'cancelled' via stopAudio). */
export function playRecording(rec: Recording): Promise<'ended' | 'error' | 'cancelled'> {
  stopAudio();
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([rec.data], { type: rec.mime }));
    const audio = new Audio(url);
    audio.dataset.role = 'playback';
    current = audio;
    currentUrl = url;
    let done = false;
    const finish = (o: 'ended' | 'error' | 'cancelled') => {
      if (done) return;
      done = true;
      if (current === audio) {
        current = undefined;
        URL.revokeObjectURL(url);
        currentUrl = undefined;
      }
      resolve(o);
    };
    audio.addEventListener('ended', () => {
      document.body.dataset.lastPlayback = 'ended';
      finish('ended');
    });
    audio.addEventListener('error', () => finish('error'));
    audio.addEventListener('pause', () => {
      if (!audio.ended) finish('cancelled');
    });
    audio.play().catch(() => finish('error'));
  });
}

export function stopAudio(): void {
  if (current) {
    const a = current;
    current = undefined;
    a.pause();
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = undefined;
  }
}
