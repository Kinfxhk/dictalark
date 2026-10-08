// SPDX-License-Identifier: AGPL-3.0-or-later
// Test-only oracles, written independently of packages/core/src/compare.
//
// osaByBfs: shortest path over alignment states (i, j) with a 0-1 BFS (deque). Moves:
// same (cost 0, only when equal), substitute, delete, insert, swap of two different
// neighbours (cost 1). This is the definition of optimal string alignment, explored
// exhaustively instead of filled into a table.
//
// damerauByBfs: plain breadth-first search over whole strings, applying any single edit
// (delete, insert any symbol, substitute, swap neighbours) anywhere, unrestricted. This is
// the true Damerau–Levenshtein distance; OSA can be larger (e.g. "ca" → "abc").

export function osaByBfs(a: readonly string[], b: readonly string[]): number {
  const n = a.length;
  const m = b.length;
  const dist = new Map<number, number>();
  const id = (i: number, j: number) => i * (m + 1) + j;
  const deque: [number, number, number][] = [[0, 0, 0]];
  while (deque.length) {
    const [i, j, c] = deque.shift()!;
    const k = id(i, j);
    if (dist.has(k)) continue;
    dist.set(k, c);
    if (i === n && j === m) return c;
    const push = (ni: number, nj: number, cost: number) => {
      if (dist.has(id(ni, nj))) return;
      if (cost === 0) deque.unshift([ni, nj, c]);
      else deque.push([ni, nj, c + 1]);
    };
    if (i < n && j < m && a[i] === b[j]) push(i + 1, j + 1, 0);
    if (i < n && j < m && a[i] !== b[j]) push(i + 1, j + 1, 1);
    if (i < n) push(i + 1, j, 1);
    if (j < m) push(i, j + 1, 1);
    if (i + 1 < n && j + 1 < m && a[i] === b[j + 1] && a[i + 1] === b[j] && a[i] !== a[i + 1])
      push(i + 2, j + 2, 1);
  }
  throw new Error('unreachable');
}

export function damerauByBfs(
  a: readonly string[],
  b: readonly string[],
  alphabet: readonly string[],
): number {
  const target = b.join('\u0001');
  const start = a.join('\u0001');
  if (start === target) return 0;
  let frontier: string[][] = [[...a]];
  const seen = new Set([start]);
  for (let d = 1; d <= a.length + b.length; d++) {
    const next: string[][] = [];
    for (const s of frontier) {
      const cands: string[][] = [];
      for (let i = 0; i <= s.length; i++) {
        if (i < s.length) cands.push([...s.slice(0, i), ...s.slice(i + 1)]);
        for (const x of alphabet) {
          cands.push([...s.slice(0, i), x, ...s.slice(i)]);
          if (i < s.length && s[i] !== x) cands.push([...s.slice(0, i), x, ...s.slice(i + 1)]);
        }
        if (i + 1 < s.length) cands.push([...s.slice(0, i), s[i + 1]!, s[i]!, ...s.slice(i + 2)]);
      }
      for (const c of cands) {
        const k = c.join('\u0001');
        if (k === target) return d;
        if (!seen.has(k) && c.length <= Math.max(a.length, b.length) + 1) {
          seen.add(k);
          next.push(c);
        }
      }
    }
    frontier = next;
  }
  throw new Error('unreachable');
}

/** Every sequence of length 0..maxLen over the alphabet. */
export function allStrings(alphabet: readonly string[], maxLen: number): string[][] {
  const out: string[][] = [[]];
  let layer: string[][] = [[]];
  for (let len = 1; len <= maxLen; len++) {
    layer = layer.flatMap((s) => alphabet.map((x) => [...s, x]));
    out.push(...layer);
  }
  return out;
}
