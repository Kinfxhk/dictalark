// SPDX-License-Identifier: AGPL-3.0-or-later
// Microphone recording adapter (MediaRecorder). Recordings never leave the device: the
// bytes go straight into IndexedDB. Stops automatically at the length limit.

import { DictalarkError, LIMITS } from '@dictalark/core';
import type { Recording } from './db';

export interface MediaRecorderLike {
  start(timesliceMs?: number): void;
  stop(): void;
  readonly state: string;
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export interface RecorderEnv {
  getUserMedia(c: { audio: boolean }): Promise<{ getTracks(): { stop(): void }[] }>;
  createRecorder(stream: unknown, mime: string | undefined): MediaRecorderLike;
  isTypeSupported(mime: string): boolean;
  now(): number;
  setTimeout(f: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

export const MIME_PREFERENCE = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export interface ActiveRecording {
  /** Resolves with the finished recording (after stop() or the time limit). */
  done: Promise<Recording>;
  stop(): void;
  /** True when the limit stopped it. */
  readonly autoStopped: boolean;
}

export async function startRecording(
  env: RecorderEnv,
  limitMs = LIMITS.recordingSeconds * 1000,
): Promise<ActiveRecording> {
  let stream: Awaited<ReturnType<RecorderEnv['getUserMedia']>>;
  try {
    stream = await env.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new DictalarkError('mic-denied');
    throw new DictalarkError('mic-unavailable');
  }
  const mime = MIME_PREFERENCE.find((m) => {
    try {
      return env.isTypeSupported(m);
    } catch {
      return false;
    }
  });
  let rec: MediaRecorderLike;
  try {
    rec = env.createRecorder(stream, mime);
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    throw new DictalarkError('mic-unavailable');
  }
  const chunks: Blob[] = [];
  const started = env.now();
  let auto = false;
  let timer: unknown = undefined;
  const done = new Promise<Recording>((resolve, reject) => {
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onerror = () => {
      env.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      reject(new DictalarkError('mic-unavailable'));
    };
    rec.onstop = () => {
      env.clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      const ms = Math.min(limitMs, Math.max(0, env.now() - started));
      const type = rec.mimeType || mime || 'audio/webm';
      const blob = new Blob(chunks, { type });
      blob.arrayBuffer().then((data) => {
        if (data.byteLength === 0) reject(new DictalarkError('recording-empty'));
        else resolve({ data, mime: type.split(';')[0]!, bytes: data.byteLength, ms });
      }, reject);
    };
  });
  rec.start(250);
  timer = env.setTimeout(() => {
    auto = true;
    if (rec.state !== 'inactive') rec.stop();
  }, limitMs);
  return {
    done,
    stop: () => {
      if (rec.state !== 'inactive') rec.stop();
    },
    get autoStopped() {
      return auto;
    },
  };
}
