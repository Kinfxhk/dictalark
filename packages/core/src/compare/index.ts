// SPDX-License-Identifier: AGPL-3.0-or-later
// Optimal string alignment (OSA) distance between two grapheme sequences, with the
// alignment that explains it: same, substitute, insert, delete, swap of neighbours.
// OSA never edits a substring twice (so it is not a metric: the triangle inequality can
// fail; see the tests). Every alignment is re-checked by check/ before it is shown.

export type OpKind = 'same' | 'sub' | 'ins' | 'del' | 'swap';
export interface Op {
  kind: OpKind;
  /** Graphemes taken from the expected answer (empty for ins). */
  a: string[];
  /** Graphemes taken from the learner's answer (empty for del). */
  b: string[];
}

export interface Alignment {
  distance: number;
  ops: Op[];
}

export function align(
  a: readonly string[],
  b: readonly string[],
  key: (g: string) => string,
): Alignment {
  const n = a.length;
  const m = b.length;
  const ka = a.map(key);
  const kb = b.map(key);
  const w = m + 1;
  const d = new Uint32Array((n + 1) * w);
  for (let i = 0; i <= n; i++) d[i * w] = i;
  for (let j = 0; j <= m; j++) d[j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = ka[i - 1] === kb[j - 1] ? 0 : 1;
      let best = Math.min(
        d[(i - 1) * w + j]! + 1, // delete a[i-1]
        d[i * w + j - 1]! + 1, // insert b[j-1]
        d[(i - 1) * w + j - 1]! + cost, // same / substitute
      );
      if (
        i > 1 &&
        j > 1 &&
        ka[i - 1] === kb[j - 2] &&
        ka[i - 2] === kb[j - 1] &&
        ka[i - 1] !== ka[i - 2]
      )
        best = Math.min(best, d[(i - 2) * w + j - 2]! + 1); // swap neighbours
      d[i * w + j] = best;
    }
  }
  // Walk back from the end, preferring same > swap > sub > del > ins on ties.
  const ops: Op[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const here = d[i * w + j]!;
    if (i > 0 && j > 0 && ka[i - 1] === kb[j - 1] && d[(i - 1) * w + j - 1] === here) {
      ops.push({ kind: 'same', a: [a[i - 1]!], b: [b[j - 1]!] });
      i--;
      j--;
    } else if (
      i > 1 &&
      j > 1 &&
      ka[i - 1] === kb[j - 2] &&
      ka[i - 2] === kb[j - 1] &&
      ka[i - 1] !== ka[i - 2] &&
      d[(i - 2) * w + j - 2]! + 1 === here
    ) {
      ops.push({ kind: 'swap', a: [a[i - 2]!, a[i - 1]!], b: [b[j - 2]!, b[j - 1]!] });
      i -= 2;
      j -= 2;
    } else if (i > 0 && j > 0 && d[(i - 1) * w + j - 1]! + 1 === here) {
      ops.push({ kind: 'sub', a: [a[i - 1]!], b: [b[j - 1]!] });
      i--;
      j--;
    } else if (i > 0 && d[(i - 1) * w + j]! + 1 === here) {
      ops.push({ kind: 'del', a: [a[i - 1]!], b: [] });
      i--;
    } else {
      ops.push({ kind: 'ins', a: [], b: [b[j - 1]!] });
      j--;
    }
  }
  ops.reverse();
  return { distance: d[n * w + m]!, ops };
}
