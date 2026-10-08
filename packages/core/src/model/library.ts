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
