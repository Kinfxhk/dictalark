// SPDX-License-Identifier: AGPL-3.0-or-later
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { CASES } from './helpers/marking-cases';
import { osaByBfs, allStrings } from '../../../test/oracle/osa-bfs';

type Core = typeof core;
const rulesWithout = (m: Core, off: core.RuleId[] = []) => {
  const r = { ...m.DEFAULT_RULES };
  for (const id of off) r[id] = false;
  return r;
};

/** Run the whole marking table, the checker table, a small oracle and properties. */
function suite(m: Core): string[] {
  const failures: string[] = [];
  for (const k of CASES) {
    try {
      const r = m.mark(k.expected, k.answer, k.accept ?? [], rulesWithout(m, k.off));
      if (r.correct !== k.correct || r.distance !== k.distance)
        failures.push(`${k.name}: got ${r.correct}/${r.distance}`);
      for (const f of k.forgiven ?? [])
        if (!r.forgiven.includes(f)) failures.push(`${k.name}: ${f} not reported`);
    } catch (e) {
      failures.push(`${k.name}: threw ${String(e)}`);
    }
  }
  for (const [name, ops, distance] of BAD_ALIGNMENTS)
    if (m.checkAlignment(['a', 'b'], ['b', 'x'], ops, distance, (g) => g).ok)
      failures.push(`checker accepted: ${name}`);
  const id = (g: string) => g;
  for (const a of allStrings(['a', 'b', '👩‍👩‍👧'], 3))
    for (const b of allStrings(['a', 'b', '👩‍👩‍👧'], 3)) {
      const al = m.align(a, b, id);
      if (al.distance !== osaByBfs(a, b)) failures.push(`oracle ${a.join('')}/${b.join('')}`);
    }
  return failures;
}

// Hand-made wrong explanations of "ab" → "bx"; the checker must refuse every one.
const BAD_ALIGNMENTS: [string, core.CheckedOp[], number][] = [
  [
    'distance too small',
    [
      { kind: 'sub', a: ['a'], b: ['b'] },
      { kind: 'sub', a: ['b'], b: ['x'] },
    ],
    1,
  ],
  [
    'same that is not the same',
    [
      { kind: 'same', a: ['a'], b: ['b'] },
      { kind: 'sub', a: ['b'], b: ['x'] },
    ],
    1,
  ],
  [
    'drops a typed letter',
    [
      { kind: 'del', a: ['a'], b: [] },
      { kind: 'same', a: ['b'], b: ['b'] },
    ],
    1,
  ],
  ['swap that is not a swap', [{ kind: 'swap', a: ['a', 'b'], b: ['b', 'x'] }], 1],
  ['unknown op', [{ kind: 'magic', a: ['a', 'b'], b: ['b', 'x'] }], 1],
  ['substitution of a letter with itself', [{ kind: 'sub', a: ['a'], b: ['a'] }], 1],
];

describe('marking (golden table)', () => {
  it('has at least 60 hand-checked cases', () => expect(CASES.length).toBeGreaterThanOrEqual(60));
  it.each(CASES.map((k) => [k.name, k] as const))('%s', (_n, k) => {
    const r = core.mark(k.expected, k.answer, k.accept ?? [], rulesWithout(core, k.off));
    expect({ correct: r.correct, distance: r.distance }).toEqual({
      correct: k.correct,
      distance: k.distance,
    });
    for (const f of k.forgiven ?? []) expect(r.forgiven).toContain(f);
  });
  it('reports which target matched', () => {
    expect(core.mark('colour', 'color', ['color']).target).toBe(0);
    expect(core.mark('colour', 'colour', ['color']).target).toBe(-1);
  });
  it('reports removed zero-width characters', () => {
    expect(core.mark('ab', 'a\u200bb').zeroWidthRemoved).toBe(true);
    expect(core.mark('ab', 'ab').zeroWidthRemoved).toBe(false);
  });
  it('shows the swap for recieve / receive', () => {
    const r = core.mark('receive', 'recieve');
    expect(r.ops.filter((o) => o.kind !== 'same')).toEqual([
      { kind: 'swap', a: ['e', 'i'], b: ['i', 'e'] },
    ]);
  });
});

describe('independent checker', () => {
  it.each(BAD_ALIGNMENTS.map((b) => [b[0], b] as const))('refuses: %s', (_n, [, ops, d]) => {
    expect(core.checkAlignment(['a', 'b'], ['b', 'x'], ops, d, (g) => g).ok).toBe(false);
  });
  it('accepts a right explanation', () => {
    const ops = [
      { kind: 'del', a: ['a'], b: [] },
      { kind: 'same', a: ['b'], b: ['b'] },
      { kind: 'ins', a: [], b: ['x'] },
    ];
    expect(core.checkAlignment(['a', 'b'], ['b', 'x'], ops, 2, (g) => g)).toEqual({ ok: true });
  });
  it('a checker rejection stops marking instead of showing a wrong diff', () => {
    // Simulate a broken diff by marking through a key that changes between calls.
    expect(() =>
      core.checkAlignment(['a'], ['A'], [{ kind: 'same', a: ['a'], b: ['A'] }], 0, (g) => g),
    ).not.toThrow();
    expect(
      core.checkAlignment(['a'], ['A'], [{ kind: 'same', a: ['a'], b: ['A'] }], 0, (g) => g).ok,
    ).toBe(false);
  });
});

const graphemeArb = fc.constantFrom(
  'a',
  'b',
  'c',
  'A',
  'é',
  'e\u0301',
  '👩‍👩‍👧',
  '🇭🇰',
  '羣',
  '群',
  '𠮷',
  ' ',
  '’',
  "'",
  'ß',
  'ı',
  'İ',
  'ש',
);
const textArb = fc.array(graphemeArb, { maxLength: 8 }).map((g) => g.join(''));

describe('marking properties', () => {
  it('every alignment passes the checker; distance is symmetric and bounded (5,000 runs)', () => {
    const key = (g: string) => core.graphemeKey(g, core.DEFAULT_RULES);
    fc.assert(
      fc.property(textArb, textArb, (x, y) => {
        const a = core.graphemes(x);
        const b = core.graphemes(y);
        const ab = core.align(a, b, key);
        expect(core.checkAlignment(a, b, ab.ops, ab.distance, key)).toEqual({ ok: true });
        expect(core.align(b, a, key).distance).toBe(ab.distance);
        expect(ab.distance).toBeLessThanOrEqual(Math.max(a.length, b.length));
        expect(ab.distance).toBeGreaterThanOrEqual(Math.abs(a.length - b.length));
        expect(ab.distance === 0).toBe(a.map(key).join('\u0001') === b.map(key).join('\u0001'));
      }),
      { numRuns: 5000 },
    );
  });
  it('mark never throws and an answer always matches itself (any Unicode, 2,000 runs)', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'binary', maxLength: 20 }),
        fc.string({ unit: 'binary', maxLength: 20 }),
        (x, y) => {
          core.mark(x, y);
          expect(core.mark(x, x).correct).toBe(true);
        },
      ),
      { numRuns: 2000 },
    );
  });
  it('a correct mark means every grapheme pair is a "same" (no hidden edits)', () => {
    fc.assert(
      fc.property(textArb, textArb, (x, y) => {
        const r = core.mark(x, y);
        expect(r.correct).toBe(r.ops.every((o) => o.kind === 'same'));
      }),
      { numRuns: 2000 },
    );
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing: each mutant is a copy of the core source with one deliberate bug.
// The suite above must notice every one of them.
// ---------------------------------------------------------------------------------
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const read = (p: string) => readFileSync(join(srcDir, ...p.split('/')), 'utf8');
const MUTANTS: [string, string, string, string][] = [
  [
    'swap counted as two substitutions',
    'compare/index.ts',
    'best = Math.min(best, d[(i - 2) * w + j - 2]! + 1);',
    'best = Math.min(best, d[(i - 2) * w + j - 2]! + 2);',
  ],
  [
    'last typed grapheme ignored',
    'compare/index.ts',
    'for (let j = 1; j <= m; j++) {',
    'for (let j = 1; j < m; j++) {',
  ],
  [
    'case rule inverted',
    'normalize/index.ts',
    "return rules.case ? g.toLowerCase().normalize('NFC') : g;",
    "return rules.case ? g : g.toLowerCase().normalize('NFC');",
  ],
  [
    'NFC skipped',
    'normalize/index.ts',
    "step('nfc', (x) => x.normalize('NFC'));",
    "step('nfc', (x) => x);",
  ],
  [
    'split by UTF-16 code unit',
    'normalize/index.ts',
    'return Array.from(SEGMENTER.segment(s), (x) => x.segment);',
    "return s.split('');",
  ],
  [
    'upper-case folding (ß→SS, ı→I)',
    'normalize/index.ts',
    "g.toLowerCase().normalize('NFC') : g;",
    "g.toUpperCase().normalize('NFC') : g;",
  ],
  [
    'NFKC on everything',
    'normalize/index.ts',
    'x.replace(FULLWIDTH_ALNUM, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),',
    "x.normalize('NFKC'),",
  ],
  [
    'swap written in the wrong order',
    'compare/index.ts',
    'b: [b[j - 2]!, b[j - 1]!]',
    'b: [b[j - 1]!, b[j - 2]!]',
  ],
  [
    'final punctuation dropped in Chinese too',
    'normalize/index.ts',
    "  else step('final-punct'",
    "  step('final-punct'",
  ],
  [
    'Chinese punctuation rule applied to English answers',
    'normalize/index.ts',
    "if (chinese) step('cjk-punct'",
    "if (true) step('cjk-punct'",
  ],
  [
    'substitution costs 2',
    'compare/index.ts',
    'const cost = ka[i - 1] === kb[j - 1] ? 0 : 1;',
    'const cost = ka[i - 1] === kb[j - 1] ? 0 : 2;',
  ],
  [
    'checker skips the distance count',
    'check/index.ts',
    '  if (edits !== distance)',
    '  if (false)',
  ],
  [
    'checker trusts "same"',
    'check/index.ts',
    "if (key(op.a[0]!) !== key(op.b[0]!)) return fail('the two sides differ');",
    '',
  ],
  [
    'curly quotes not mapped',
    'normalize/index.ts',
    `step('quotes', (x) => x.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"'));`,
    '',
  ],
];

const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});

describe('mutation testing (marking)', () => {
  it('has at least 8 mutants and each one changes the source exactly once', () => {
    expect(MUTANTS.length).toBeGreaterThanOrEqual(8);
    for (const [name, file, from] of MUTANTS)
      expect(read(file).split(from).length - 1, name).toBe(1);
  });
  it('the unmutated core passes the whole suite', () => {
    expect(suite(core)).toEqual([]);
  });
  for (const [name, file, from, to] of MUTANTS)
    it(`catches mutant: ${name}`, async () => {
      const dir = join(srcDir, `m${MUTANTS.findIndex((m) => m[0] === name)}-mutant-${process.pid}`);
      created.push(dir);
      mkdirSync(dir, { recursive: true });
      for (const entry of readdirSync(srcDir))
        if (!entry.includes('-mutant-'))
          cpSync(join(srcDir, entry), join(dir, entry), { recursive: true });
      writeFileSync(join(dir, ...file.split('/')), read(file).replace(from, to));
      const mod = (await import(pathToFileURL(join(dir, 'index.ts')).href)) as Core;
      const failed = suite(mod);
      expect(failed.length, `mutant "${name}" survived`).toBeGreaterThan(0);
    });
});
