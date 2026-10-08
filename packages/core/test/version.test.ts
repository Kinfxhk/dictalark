// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { MARKING_VERSION, SCHEMA_VERSION } from '../src/index';

describe('versions', () => {
  it('are positive integers', () => {
    for (const v of [SCHEMA_VERSION, MARKING_VERSION])
      expect(Number.isInteger(v) && v > 0).toBe(true);
  });
});
