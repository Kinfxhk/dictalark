// SPDX-License-Identifier: AGPL-3.0-or-later
// IndexedDB storage. Everything Dictalark keeps lives here, on this device only:
//   store "kv":         "library" (lists, practice history, review schedule), "settings",
//                       "recBytes" (running total of recording sizes)
//   store "recordings": `${listId}/${itemId}` → { data: ArrayBuffer, mime, bytes, ms }
// Recordings are stored as ArrayBuffer (not Blob) because Blob storage has been unreliable
// in some browsers. Every write is one transaction: if the device runs out of space the
// transaction aborts and nothing that was saved before is touched.

import { DictalarkError, LIMITS, type Library } from '@dictalark/core';

export const DB_NAME = 'dictalark';
const DB_VERSION = 1;

export interface Recording {
  data: ArrayBuffer;
  mime: string;
  bytes: number;
  /** Length in milliseconds. */
  ms: number;
}

export interface Store {
  loadLibrary(): Promise<Library | undefined>;
  saveLibrary(lib: Library): Promise<void>;
  loadSettings<T>(): Promise<T | undefined>;
  saveSettings<T>(s: T): Promise<void>;
  putRecording(key: string, rec: Recording): Promise<void>;
  getRecording(key: string): Promise<Recording | undefined>;
  deleteRecording(key: string): Promise<void>;
  /** Delete every recording whose key starts with `${listId}/`. */
  deleteRecordingsOf(listId: string): Promise<void>;
  recordingKeys(): Promise<string[]>;
  recordingBytes(): Promise<number>;
  /** Delete everything Dictalark stored on this device. */
  wipe(): Promise<void>;
  close(): void;
}

const isQuota = (e: unknown) =>
  !!e && typeof e === 'object' && (e as { name?: string }).name === 'QuotaExceededError';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Run `body` in one transaction; resolve when it commits, reject (and roll back) otherwise. */
function tx<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (t: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, mode);
    } catch (e) {
      reject(isQuota(e) ? new DictalarkError('storage-full') : e);
      return;
    }
    let result: T;
    let failed: unknown;
    t.oncomplete = () => resolve(result);
    t.onabort = () => {
      const e = failed ?? t.error;
      reject(
        isQuota(e) ? new DictalarkError('storage-full') : (e ?? new Error('transaction aborted')),
      );
    };
    Promise.resolve()
      .then(() => body(t))
      .then(
        (r) => {
          result = r;
        },
        (e: unknown) => {
          failed = e;
          try {
            t.abort();
          } catch {
            /* already finished */
          }
        },
      );
  });
}

export function openStore(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<Store> {
  return new Promise((resolve, reject) => {
    const open = factory.open(name, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('recordings')) db.createObjectStore('recordings');
    };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => resolve(wrap(open.result, factory, name));
  });
}

function wrap(db: IDBDatabase, factory: IDBFactory, name: string): Store {
  const kvGet = <T>(key: string) =>
    tx(db, ['kv'], 'readonly', (t) => req(t.objectStore('kv').get(key)) as Promise<T | undefined>);
  const kvPut = (key: string, value: unknown) =>
    tx(db, ['kv'], 'readwrite', async (t) => {
      await req(t.objectStore('kv').put(value, key));
    });
  const store: Store = {
    loadLibrary: () => kvGet<Library>('library'),
    saveLibrary: (lib) => kvPut('library', lib),
    loadSettings: <T>() => kvGet<T>('settings'),
    saveSettings: (s) => kvPut('settings', s),
    putRecording: (key, rec) => {
      if (rec.bytes <= 0 || rec.data.byteLength === 0)
        return Promise.reject(new DictalarkError('recording-empty'));
      if (rec.ms > LIMITS.recordingSeconds * 1000 + 1000)
        return Promise.reject(
          new DictalarkError('recording-too-long', { max: LIMITS.recordingSeconds }),
        );
      return tx(db, ['kv', 'recordings'], 'readwrite', async (t) => {
        const kv = t.objectStore('kv');
        const recs = t.objectStore('recordings');
        const total = ((await req(kv.get('recBytes'))) as number | undefined) ?? 0;
        const old = (await req(recs.get(key))) as Recording | undefined;
        const next = total - (old?.bytes ?? 0) + rec.bytes;
        if (next > LIMITS.recordingBytesTotal)
          throw new DictalarkError('recordings-full', { max: LIMITS.recordingBytesTotal });
        await req(recs.put(rec, key));
        await req(kv.put(next, 'recBytes'));
      });
    },
    getRecording: (key) =>
      tx(
        db,
        ['recordings'],
        'readonly',
        (t) => req(t.objectStore('recordings').get(key)) as Promise<Recording | undefined>,
      ),
    deleteRecording: (key) =>
      tx(db, ['kv', 'recordings'], 'readwrite', async (t) => {
        const kv = t.objectStore('kv');
        const recs = t.objectStore('recordings');
        const old = (await req(recs.get(key))) as Recording | undefined;
        if (!old) return;
        const total = ((await req(kv.get('recBytes'))) as number | undefined) ?? 0;
        await req(recs.delete(key));
        await req(kv.put(Math.max(0, total - old.bytes), 'recBytes'));
      }),
    deleteRecordingsOf: async (listId) => {
      for (const k of await store.recordingKeys())
        if (k.startsWith(`${listId}/`)) await store.deleteRecording(k);
    },
    recordingKeys: () =>
      tx(db, ['recordings'], 'readonly', async (t) =>
        (await req(t.objectStore('recordings').getAllKeys())).map(String),
      ),
    recordingBytes: async () => (await kvGet<number>('recBytes')) ?? 0,
    wipe: async () => {
      db.close();
      await new Promise<void>((resolve, reject) => {
        const d = factory.deleteDatabase(name);
        d.onsuccess = () => resolve();
        d.onerror = () => reject(d.error);
        d.onblocked = () => resolve();
      });
    },
    close: () => db.close(),
  };
  return store;
}
