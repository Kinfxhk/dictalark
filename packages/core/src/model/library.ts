// SPDX-License-Identifier: AGPL-3.0-or-later
// JSON export / import of the whole library (lists, practice history, review schedule).

import { SCHEMA_VERSION } from '../version';
import { base64ToBytes, bytesToBase64 } from './base64';
import { DictalarkError } from './errors';
import { safeJsonParse } from './json';
import { LIMITS } from './limits';
import { migrate } from './migrate';
import type { BackupRecording, ExportFile, Library } from './types';
import {
  assertUniqueIds,
  isObj,
  validateId,
  validateAttempt,
  validateList,
  validateSrs,
  validateTimestamp,
} from './validate';

export function toExportFile(lib: Library, exportedAt: string): ExportFile {
  return {
    format: 'dictalark',
    schema: SCHEMA_VERSION,
    exportedAt,
    lists: lib.lists,
    attempts: lib.attempts,
    srs: lib.srs,
  };
}

export function serializeLibrary(lib: Library, exportedAt: string): string {
  return JSON.stringify(toExportFile(lib, exportedAt), null, 2) + '\n';
}

/** Recording types a backup may carry (what browsers record, plus common audio files). */
export const RECORDING_MIME_RE =
  /^audio\/(webm|ogg|mp4|mpeg|aac|wav|x-wav)(;\s?codecs="?[A-Za-z0-9.,\- ]{1,40}"?)?$/;

/**
 * Full backup: the library plus every recording, in one JSON file (schema 2). Recordings
 * whose list or item no longer exists are left out.
 */
export function serializeBackup(
  lib: Library,
  recordings: readonly BackupRecording[],
  exportedAt: string,
): string {
  const items = new Set(lib.lists.flatMap((l) => l.items.map((i) => `${l.id}/${i.id}`)));
  const file: ExportFile = {
    ...toExportFile(lib, exportedAt),
    recordings: recordings
      .filter((r) => items.has(`${r.listId}/${r.itemId}`))
      .map((r) => ({
        listId: r.listId,
        itemId: r.itemId,
        mime: r.mime,
        // Browsers measure recordings with a fractional clock; files hold whole ms.
        ms: Math.max(0, Math.round(r.ms)),
        data: bytesToBase64(r.data),
      })),
  };
  return JSON.stringify(file, null, 2) + '\n';
}

/** Parse a backup and its recordings. v0.1 files (schema 1) have none and still load. */
export function parseBackup(
  text: string,
): Library & { exportedAt: string; recordings: BackupRecording[] } {
  const raw = safeJsonParse(text, LIMITS.backupBytes);
  const lib = parseLibraryData(raw);
  const recsRaw = (raw as { recordings?: unknown }).recordings ?? [];
  if (!Array.isArray(recsRaw))
    throw new DictalarkError('bad-shape', { path: 'recordings', expected: 'array' });
  const items = new Set(lib.lists.flatMap((l) => l.items.map((i) => `${l.id}/${i.id}`)));
  const seen = new Set<string>();
  let total = 0;
  const recordings = recsRaw.map((r, i): BackupRecording => {
    const p = `recordings[${i}]`;
    if (!isObj(r)) throw new DictalarkError('bad-shape', { path: p, expected: 'object' });
    const listId = validateId(r.listId, `${p}.listId`);
    const itemId = validateId(r.itemId, `${p}.itemId`);
    const key = `${listId}/${itemId}`;
    if (!items.has(key))
      throw new DictalarkError('bad-shape', {
        path: p,
        expected: 'a recording of an item in the file',
      });
    if (seen.has(key)) throw new DictalarkError('duplicate-id', { path: 'recordings', id: key });
    seen.add(key);
    if (typeof r.mime !== 'string' || !RECORDING_MIME_RE.test(r.mime))
      throw new DictalarkError('bad-shape', { path: `${p}.mime`, expected: 'an audio type' });
    const ms = r.ms;
    if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 0)
      throw new DictalarkError('bad-shape', { path: `${p}.ms`, expected: 'whole milliseconds' });
    if (ms > LIMITS.recordingSeconds * 1000 + 1000)
      throw new DictalarkError('recording-too-long', { max: LIMITS.recordingSeconds });
    if (typeof r.data !== 'string' || r.data.length > Math.ceil(LIMITS.recordingBytesEach / 3) * 4)
      throw new DictalarkError('too-large', { max: LIMITS.recordingBytesEach });
    const data = base64ToBytes(r.data, `${p}.data`);
    if (data.byteLength === 0) throw new DictalarkError('recording-empty');
    total += data.byteLength;
    if (total > LIMITS.recordingBytesTotal)
      throw new DictalarkError('recordings-full', { max: LIMITS.recordingBytesTotal });
    return { listId, itemId, mime: r.mime, ms, data };
  });
  return { ...lib, recordings };
}

/** Parse and validate an export file. Throws DictalarkError on anything suspicious. */
export function parseLibrary(text: string): Library & { exportedAt: string } {
  return parseLibraryData(safeJsonParse(text));
}

function parseLibraryData(raw: unknown): Library & { exportedAt: string } {
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { format?: unknown }).format !== 'dictalark'
  )
    throw new DictalarkError('unknown-format');
  const data = migrate(raw);
  const lists = Array.isArray(data.lists) ? data.lists : [];
  if (!Array.isArray(data.lists))
    throw new DictalarkError('bad-shape', { path: 'lists', expected: 'array' });
  if (lists.length > LIMITS.lists)
    throw new DictalarkError('too-many-lists', { max: LIMITS.lists });
  const validLists = lists.map((l, i) => validateList(l, `lists[${i}]`));
  assertUniqueIds(
    validLists.map((l) => l.id),
    'lists',
  );
  const attemptsRaw = data.attempts ?? [];
  if (!Array.isArray(attemptsRaw))
    throw new DictalarkError('bad-shape', { path: 'attempts', expected: 'array' });
  if (attemptsRaw.length > LIMITS.lists * LIMITS.attemptsPerList)
    throw new DictalarkError('too-many-items', {
      path: 'attempts',
      max: LIMITS.lists * LIMITS.attemptsPerList,
    });
  const attempts = attemptsRaw.map((a, i) => validateAttempt(a, `attempts[${i}]`));
  assertUniqueIds(
    attempts.map((a) => a.id),
    'attempts',
  );
  return {
    exportedAt: validateTimestamp(data.exportedAt, 'exportedAt'),
    lists: validLists,
    attempts,
    srs: validateSrs(data.srs ?? {}),
  };
}

/**
 * Add an imported library to the existing one. Lists, attempts and review cards from the
 * import are kept; an imported list whose id is already used gets a fresh id (and its
 * attempts and review cards follow it), so nothing on the device is overwritten.
 */
export function mergeLibrary(base: Library, incoming: Library, newId: () => string): Library {
  return mergeLibraryWithIds(base, incoming, newId).lib;
}

/** As mergeLibrary, also returning imported list id → id on this device. */
export function mergeLibraryWithIds(
  base: Library,
  incoming: Library,
  newId: () => string,
): { lib: Library; listIds: Map<string, string> } {
  if (base.lists.length + incoming.lists.length > LIMITS.lists)
    throw new DictalarkError('too-many-lists', { max: LIMITS.lists });
  const used = new Set(base.lists.map((l) => l.id));
  const usedAttempts = new Set(base.attempts.map((a) => a.id));
  const fresh = (taken: Set<string>) => {
    for (let i = 0; i < 100; i++) {
      const id = newId();
      if (!taken.has(id)) return id;
    }
    throw new Error('could not make a unique id');
  };
  const rename = new Map<string, string>();
  const lists = incoming.lists.map((l) => {
    const id = used.has(l.id) ? fresh(used) : l.id;
    used.add(id);
    rename.set(l.id, id);
    return { ...l, id, items: l.items.map((it) => ({ ...it, accept: [...it.accept] })) };
  });
  const attempts = incoming.attempts
    .filter((a) => rename.has(a.listId))
    .map((a) => {
      const id = usedAttempts.has(a.id) ? fresh(usedAttempts) : a.id;
      usedAttempts.add(id);
      return { ...a, id, listId: rename.get(a.listId)!, entries: a.entries.map((e) => ({ ...e })) };
    });
  const srs = { ...base.srs };
  for (const [key, card] of Object.entries(incoming.srs)) {
    const slash = key.indexOf('/');
    const to = rename.get(key.slice(0, slash));
    if (slash > 0 && to) srs[`${to}${key.slice(slash)}`] = { ...card };
  }
  return {
    lib: { lists: [...base.lists, ...lists], attempts: [...base.attempts, ...attempts], srs },
    listIds: rename,
  };
}
