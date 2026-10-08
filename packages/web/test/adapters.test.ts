// SPDX-License-Identifier: AGPL-3.0-or-later
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { DictalarkError, LIMITS, type Library } from '@dictalark/core';
import { openStore, type Recording } from '../src/db';
import { startRecording, type MediaRecorderLike, type RecorderEnv } from '../src/recorder';
import { createSpeaker, type SynthLike, type Timers, type UtteranceLike } from '../src/speaker';

// ---------------------------------------------------------------- speech -----------
function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; f: () => void }>();
  let id = 0;
  const timers: Timers = {
    setTimeout: (f, ms) => {
      pending.set(++id, { at: now + ms, f });
      return id;
    },
    clearTimeout: (i) => void pending.delete(i as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [k, t] of [...pending])
      if (t.at <= now) {
        pending.delete(k);
        t.f();
      }
  };
  return { timers, advance, pending };
}
function fakeSynth(behaviour: 'end' | 'never' | 'throw' | 'error') {
  const spoken: UtteranceLike[] = [];
  let cancels = 0;
  const synth: SynthLike = {
    speak(u) {
      if (behaviour === 'throw') throw new Error('not allowed');
      spoken.push(u);
      if (behaviour === 'end') queueMicrotask(() => u.onend?.());
      if (behaviour === 'error') queueMicrotask(() => u.onerror?.({ error: 'synthesis-failed' }));
    },
    cancel() {
      cancels++;
      for (const u of spoken) u.onerror?.({ error: 'interrupted' });
    },
    getVoices: () => [],
  };
  const make = (text: string): UtteranceLike => ({
    text,
    lang: '',
    rate: 1,
    voice: null,
    onend: null,
    onerror: null,
  });
  return { synth, make, spoken, cancels: () => cancels };
}

describe('speaker adapter', () => {
  it('resolves "ended" and passes language, voice and a clamped rate', async () => {
    const t = fakeTimers();
    const s = fakeSynth('end');
    const sp = createSpeaker(s.synth, s.make, t.timers);
    const voice = { name: 'GB', lang: 'en-GB', localService: true };
    await expect(sp.speak('spoon', 'en-GB', voice, 9)).resolves.toBe('ended');
    expect(s.spoken[0]).toMatchObject({ text: 'spoon', lang: 'en-GB', rate: 2, voice });
    expect(t.pending.size).toBe(0);
  });
  it('speechSynthesis.speak throwing → "error", not a hang', async () => {
    const t = fakeTimers();
    const s = fakeSynth('throw');
    await expect(
      createSpeaker(s.synth, s.make, t.timers).speak('x', 'en-GB', undefined, 1),
    ).resolves.toBe('error');
  });
  it('"end" never firing → "timeout" after the limit, and the voice is cancelled', async () => {
    const t = fakeTimers();
    const s = fakeSynth('never');
    const p = createSpeaker(s.synth, s.make, t.timers).speak('cat', 'en-GB', undefined, 1);
    t.advance(5349);
    t.advance(1);
    await expect(p).resolves.toBe('timeout');
    expect(s.cancels()).toBe(1);
  });
  it('a synthesis error → "error"', async () => {
    const s = fakeSynth('error');
    await expect(
      createSpeaker(s.synth, s.make, fakeTimers().timers).speak('x', 'en', undefined, 1),
    ).resolves.toBe('error');
  });
  it('cancel() resolves the current reading as "cancelled"; a new speak cancels the old one', async () => {
    const s = fakeSynth('never');
    const sp = createSpeaker(s.synth, s.make, fakeTimers().timers);
    const a = sp.speak('a', 'en', undefined, 1);
    const b = sp.speak('b', 'en', undefined, 1);
    await expect(a).resolves.toBe('cancelled');
    sp.cancel();
    await expect(b).resolves.toBe('cancelled');
  });
});

// ---------------------------------------------------------------- recorder ---------
function fakeRecorderEnv(opts: { deny?: string; chunks?: number[]; noRecorder?: boolean } = {}) {
  let now = 1000;
  const t = fakeTimers();
  const stopped: string[] = [];
  let recorder: (MediaRecorderLike & { emit(): void }) | undefined;
  const env: RecorderEnv = {
    getUserMedia: async () => {
      if (opts.deny) throw Object.assign(new Error('x'), { name: opts.deny });
      return { getTracks: () => [{ stop: () => stopped.push('track') }] };
    },
    createRecorder: (_s, mime) => {
      if (opts.noRecorder) throw new Error('no MediaRecorder');
      const r = {
        state: 'inactive',
        mimeType: mime ?? '',
        ondataavailable: null as MediaRecorderLike['ondataavailable'],
        onstop: null as MediaRecorderLike['onstop'],
        onerror: null as MediaRecorderLike['onerror'],
        start() {
          this.state = 'recording';
        },
        stop() {
          this.state = 'inactive';
          for (const n of opts.chunks ?? [100])
            this.ondataavailable?.({ data: new Blob([new Uint8Array(n)]) });
          this.onstop?.();
        },
        emit() {},
      };
      recorder = r;
      return r;
    },
    isTypeSupported: (m) => m === 'audio/webm',
    now: () => now,
    setTimeout: t.timers.setTimeout,
    clearTimeout: t.timers.clearTimeout,
  };
  return {
    env,
    advance: (ms: number) => ((now += ms), t.advance(ms)),
    stopped,
    rec: () => recorder,
  };
}

describe('recorder adapter', () => {
  it('records, stops on request, releases the microphone', async () => {
    const f = fakeRecorderEnv({ chunks: [10, 20] });
    const r = await startRecording(f.env);
    f.advance(2500);
    r.stop();
    const rec = await r.done;
    expect(rec).toMatchObject({ mime: 'audio/webm', bytes: 30, ms: 2500 });
    expect(f.stopped).toEqual(['track']);
    expect(r.autoStopped).toBe(false);
  });
  it('stops by itself at 30 seconds', async () => {
    const f = fakeRecorderEnv();
    const r = await startRecording(f.env);
    f.advance(LIMITS.recordingSeconds * 1000);
    const rec = await r.done;
    expect(r.autoStopped).toBe(true);
    expect(rec.ms).toBe(30_000);
  });
  it('permission refused → mic-denied', async () => {
    await expect(
      startRecording(fakeRecorderEnv({ deny: 'NotAllowedError' }).env),
    ).rejects.toMatchObject({ code: 'mic-denied' });
  });
  it('no microphone → mic-unavailable', async () => {
    await expect(
      startRecording(fakeRecorderEnv({ deny: 'NotFoundError' }).env),
    ).rejects.toMatchObject({ code: 'mic-unavailable' });
  });
  it('no MediaRecorder → mic-unavailable and the microphone is released', async () => {
    const f = fakeRecorderEnv({ noRecorder: true });
    await expect(startRecording(f.env)).rejects.toMatchObject({ code: 'mic-unavailable' });
    expect(f.stopped).toEqual(['track']);
  });
  it('0 bytes recorded → recording-empty', async () => {
    const f = fakeRecorderEnv({ chunks: [0] });
    const r = await startRecording(f.env);
    r.stop();
    await expect(r.done).rejects.toMatchObject({ code: 'recording-empty' });
  });
});

// ---------------------------------------------------------------- IndexedDB --------
const lib = (name: string): Library => ({
  lists: [
    {
      id: 'l1',
      name,
      subject: 'english',
      lang: 'en-GB',
      items: [{ id: 'i1', text: 'spoon', accept: [], note: '' }],
      createdAt: '2026-10-08T02:00:00Z',
      updatedAt: '2026-10-08T02:00:00Z',
    },
  ],
  attempts: [],
  srs: {},
});
const rec = (bytes: number, ms = 1000): Recording => ({
  data: new Uint8Array(bytes).buffer,
  mime: 'audio/webm',
  bytes,
  ms,
});

describe('IndexedDB store', () => {
  it('saves and loads the library, settings and recordings; keeps the byte total', async () => {
    const db = await openStore(new IDBFactory(), 't1');
    expect(await db.loadLibrary()).toBeUndefined();
    await db.saveLibrary(lib('A'));
    expect((await db.loadLibrary())?.lists[0]?.name).toBe('A');
    await db.saveSettings({ locale: 'zh-HK' });
    expect(await db.loadSettings()).toEqual({ locale: 'zh-HK' });
    await db.putRecording('l1/i1', rec(100));
    await db.putRecording('l1/i2', rec(50));
    await db.putRecording('l1/i1', rec(70)); // replace
    expect(await db.recordingBytes()).toBe(120);
    expect((await db.getRecording('l1/i1'))?.bytes).toBe(70);
    await db.deleteRecordingsOf('l1');
    expect(await db.recordingKeys()).toEqual([]);
    expect(await db.recordingBytes()).toBe(0);
    db.close();
  });

  it('a quota error is reported clearly and the old data is not damaged', async () => {
    const db = await openStore(new IDBFactory(), 't2');
    await db.saveLibrary(lib('old'));
    await db.putRecording('l1/i1', rec(10));
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: IDBObjectStore } })
      .IDBObjectStore.prototype;
    const spy = vi.spyOn(proto, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      await expect(db.saveLibrary(lib('new'))).rejects.toMatchObject({ code: 'storage-full' });
      await expect(db.putRecording('l1/i2', rec(10))).rejects.toMatchObject({
        code: 'storage-full',
      });
    } finally {
      spy.mockRestore();
    }
    expect((await db.loadLibrary())?.lists[0]?.name).toBe('old');
    expect(await db.recordingKeys()).toEqual(['l1/i1']);
    expect(await db.recordingBytes()).toBe(10);
    db.close();
  });

  it('a quota error in the second write of a transaction rolls back the first', async () => {
    const db = await openStore(new IDBFactory(), 't3');
    await db.putRecording('l1/i1', rec(10));
    const proto = (globalThis as unknown as { IDBObjectStore: { prototype: IDBObjectStore } })
      .IDBObjectStore.prototype;
    const real = proto.put;
    const spy = vi.spyOn(proto, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      if (this.name === 'kv') throw new DOMException('full', 'QuotaExceededError');
      return real.apply(this, args);
    });
    try {
      await expect(db.putRecording('l1/i2', rec(10))).rejects.toMatchObject({
        code: 'storage-full',
      });
    } finally {
      spy.mockRestore();
    }
    expect(await db.recordingKeys()).toEqual(['l1/i1']); // the recording put was rolled back
    expect(await db.recordingBytes()).toBe(10);
    db.close();
  });

  it('refuses recordings over the total limit, empty ones and over-long ones', async () => {
    const db = await openStore(new IDBFactory(), 't4');
    await expect(
      db.putRecording('l1/x', rec(LIMITS.recordingBytesTotal + 1)),
    ).rejects.toMatchObject({ code: 'recordings-full' });
    await expect(db.putRecording('l1/x', rec(0))).rejects.toMatchObject({
      code: 'recording-empty',
    });
    await expect(db.putRecording('l1/x', rec(5, 45_000))).rejects.toMatchObject({
      code: 'recording-too-long',
    });
    expect(await db.recordingKeys()).toEqual([]);
    db.close();
  });

  it('wipe deletes everything', async () => {
    const f = new IDBFactory();
    const db = await openStore(f, 't5');
    await db.saveLibrary(lib('A'));
    await db.putRecording('l1/i1', rec(5));
    await db.wipe();
    const again = await openStore(f, 't5');
    expect(await again.loadLibrary()).toBeUndefined();
    expect(await again.recordingKeys()).toEqual([]);
    again.close();
  });

  it('errors are DictalarkError instances (so the UI can translate them)', async () => {
    const db = await openStore(new IDBFactory(), 't6');
    await db
      .putRecording('k/x', rec(0))
      .catch((e: unknown) => expect(e).toBeInstanceOf(DictalarkError));
    db.close();
  });
});
