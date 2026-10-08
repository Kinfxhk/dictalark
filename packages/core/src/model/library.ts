// SPDX-License-Identifier: AGPL-3.0-or-later
// JSON export / import of the whole library (lists, practice history, review schedule).

import { SCHEMA_VERSION } from '../version';
import { DictalarkError } from './errors';
import { safeJsonParse } from './json';
import { LIMITS } from './limits';
import { migrate } from './migrate';
import type { ExportFile, Library } from './types';
import {
  assertUniqueIds,
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

/** Parse and validate an export file. Throws DictalarkError on anything suspicious. */
export function parseLibrary(text: string): Library & { exportedAt: string } {
  const raw = safeJsonParse(text);
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
  return { lists: [...base.lists, ...lists], attempts: [...base.attempts, ...attempts], srs };
}
