// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { align, checkAlignment } from '../../packages/core/src/index';
import { allStrings, damerauByBfs, osaByBfs } from './osa-bfs';

const ALPHABET = ['a', 'b', '👩‍👩‍👧']; // one emoji grapheme made of five code points
const id = (g: string) => g;

describe('edit distance oracle', () => {
  it('DP distance equals the exhaustive BFS for every pair of strings up to 5 graphemes (alphabet 3)', () => {
    const all = allStrings(ALPHABET, 5);
    expect(all.length).toBe(364);
    let pairs = 0;
    const mismatches: string[] = [];
    for (const a of all)
      for (const b of all) {
        const { distance, ops } = align(a, b, id);
        const truth = osaByBfs(a, b);
        if (distance !== truth)
          mismatches.push(`${a.join('')} → ${b.join('')}: ${distance} ≠ ${truth}`);
        const verdict = checkAlignment(a, b, ops, distance, id);
        if (!verdict.ok) mismatches.push(`${a.join('')} → ${b.join('')}: ${verdict.reason}`);
        pairs++;
      }
    expect(pairs).toBe(364 * 364);
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('OSA is never below true Damerau–Levenshtein, and differs exactly where expected (≤3 graphemes)', () => {
    const all = allStrings(['a', 'b', 'c'], 3);
    const differ: string[] = [];
    for (const a of all)
      for (const b of all) {
        const osa = align(a, b, id).distance;
        const dl = damerauByBfs(a, b, ['a', 'b', 'c']);
        expect(osa).toBeGreaterThanOrEqual(dl);
        if (osa !== dl) differ.push(`${a.join('')}→${b.join('')}`);
      }
    // The textbook counterexample: "ca" → "abc" is 3 for OSA (no substring edited twice)
    // but 2 for unrestricted Damerau–Levenshtein ("ca" → "ac" → "abc").
    expect(differ).toContain('ca→abc');
  });

  it('OSA is not a metric: the triangle inequality fails on a known example', () => {
    const d = (x: string, y: string) => align([...x], [...y], id).distance;
    expect(d('ca', 'ac')).toBe(1);
    expect(d('ac', 'abc')).toBe(1);
    expect(d('ca', 'abc')).toBe(3); // > 1 + 1
  });
});
