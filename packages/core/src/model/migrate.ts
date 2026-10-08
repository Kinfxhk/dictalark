// SPDX-License-Identifier: AGPL-3.0-or-later
// Saved-data migrations. Each entry upgrades schema N to N+1. Files from a newer
// Dictalark are refused with a clear message instead of being half-read.

import { SCHEMA_VERSION } from '../version';
import { DictalarkError } from './errors';
import { isObj } from './validate';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * 1 → 2 (v0.2): items may have `say`, and the file may carry `recordings`. Both are
 * optional, so a schema-1 file is already a valid schema-2 file.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = Object.freeze({
  1: (d: Record<string, unknown>) => ({ ...d }),
});

export function migrate(
  data: unknown,
  { target = SCHEMA_VERSION, migrations = MIGRATIONS } = {},
): Record<string, unknown> {
  if (!isObj(data)) throw new DictalarkError('bad-shape', { path: '$', expected: 'object' });
  const v = data.schema;
  if (v === undefined) throw new DictalarkError('missing-schema');
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1)
    throw new DictalarkError('bad-shape', { path: 'schema', expected: 'positive integer' });
  if (v > target) throw new DictalarkError('future-schema', { found: v, supported: target });
  let cur: Record<string, unknown> = data;
  for (let n = v; n < target; n++) {
    const step = migrations[n];
    if (!step) throw new DictalarkError('bad-shape', { path: 'schema', expected: `<= ${target}` });
    cur = { ...step(cur), schema: n + 1 };
  }
  return cur;
}
