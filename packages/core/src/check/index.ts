// SPDX-License-Identifier: AGPL-3.0-or-later
// Independent checker for marking diffs. It must not import compare/ (enforced by ESLint
// and the hygiene script), so a bug in the diff engine cannot vouch for itself.
// It proves that the alignment is a faithful explanation:
//   1. reading the expected side of the operations gives exactly the expected answer;
//   2. reading the learner side gives exactly what the learner typed;
//   3. every "same" really is the same (under the marking key), every other operation
//      really is a difference of its kind;
//   4. the reported distance equals the number of non-"same" operations.

export interface CheckedOp {
  kind: string;
  a: readonly string[];
  b: readonly string[];
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

export function checkAlignment(
  expected: readonly string[],
  answer: readonly string[],
  ops: readonly CheckedOp[],
  distance: number,
  key: (g: string) => string,
): CheckResult {
  const ea: string[] = [];
  const eb: string[] = [];
  let edits = 0;
  for (const [n, op] of ops.entries()) {
    const fail = (why: string): CheckResult => ({
      ok: false,
      reason: `op ${n} (${op.kind}): ${why}`,
    });
    switch (op.kind) {
      case 'same':
        if (op.a.length !== 1 || op.b.length !== 1) return fail('needs one grapheme each side');
        if (key(op.a[0]!) !== key(op.b[0]!)) return fail('the two sides differ');
        break;
      case 'sub':
        if (op.a.length !== 1 || op.b.length !== 1) return fail('needs one grapheme each side');
        if (key(op.a[0]!) === key(op.b[0]!)) return fail('substitutes a grapheme with itself');
        edits++;
        break;
      case 'del':
        if (op.a.length !== 1 || op.b.length !== 0) return fail('must take one expected grapheme');
        edits++;
        break;
      case 'ins':
        if (op.a.length !== 0 || op.b.length !== 1) return fail('must take one typed grapheme');
        edits++;
        break;
      case 'swap': {
        if (op.a.length !== 2 || op.b.length !== 2) return fail('needs two graphemes each side');
        const [x, y] = op.a.map(key);
        const [p, q] = op.b.map(key);
        if (x === y || x !== q || y !== p) return fail('is not a swap of two different neighbours');
        edits++;
        break;
      }
      default:
        return fail('unknown operation');
    }
    ea.push(...op.a);
    eb.push(...op.b);
  }
  if (ea.length !== expected.length || ea.some((g, i) => g !== expected[i]))
    return { ok: false, reason: 'expected side does not rebuild the expected answer' };
  if (eb.length !== answer.length || eb.some((g, i) => g !== answer[i]))
    return { ok: false, reason: 'learner side does not rebuild the typed answer' };
  if (edits !== distance)
    return { ok: false, reason: `distance ${distance} but ${edits} edits in the alignment` };
  return { ok: true };
}
