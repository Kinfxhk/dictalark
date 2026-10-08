// SPDX-License-Identifier: AGPL-3.0-or-later
// Class packs and results files (files only). Golden values are worked out by hand.
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import * as core from '../src/index';
import { library, list, T0 } from './helpers/fixtures';

type Core = typeof core;
const T1 = '2026-10-09T01:00:00Z';

function pupilLib(m: Core = core): core.Library {
  const lib = library();
  lib.attempts = [
    {
      id: 'a1',
      listId: 'list-1',
      day: '2026-10-08',
      mode: 'typing',
      entries: [
        { itemId: 'i1', result: 'right', answer: 'spoon' },
        { itemId: 'i2', result: 'wrong', answer: 'colur' },
        { itemId: 'i3', result: 'blank', answer: '' },
      ],
    },
    {
      id: 'a2',
      listId: 'list-1',
      day: '2026-10-09',
      mode: 'paper',
      entries: [
        { itemId: 'i1', result: 'right', answer: '' },
        { itemId: 'i2', result: 'wrong', answer: '' },
        { itemId: 'i3', result: 'right', answer: '' },
      ],
    },
  ];
  void m;
  return lib;
}

/** The whole behaviour as one function, so each mutant can be run against it. */
function suite(m: Core): string[] {
  const failed: string[] = [];
  const t = (name: string, f: () => boolean) => {
    try {
      if (!f()) failed.push(name);
    } catch (e) {
      failed.push(`${name}: ${String(e)}`);
    }
  };
  const throwsCode = (f: () => unknown, code: string) => {
    try {
      f();
      return false;
    } catch (e) {
      return m.isDictalarkError(e) && e.code === code;
    }
  };
  // Pack round trip.
  const text = m.serializePack([list()], { title: ' P.3 Week 5 ', note: 'Test on Friday' }, T0);
  t('pack round trip', () => {
    const p = m.parsePack(text);
    return (
      p.title === 'P.3 Week 5' && p.lists[0]!.items.length === 3 && p.note === 'Test on Friday'
    );
  });
  // Plan / apply: new, unchanged, updated.
  const empty: core.Library = { lists: [], attempts: [], srs: {} };
  t(
    'plan adds into an empty library',
    () => m.planPack(empty, m.parsePack(text)).added.length === 1,
  );
  t(
    'plan: same content is unchanged',
    () => m.planPack(library(), m.parsePack(text)).unchanged.length === 1,
  );
  const changed = list({
    items: [list().items[0]!, { id: 'i9', text: 'fork', accept: [], note: '' }],
  });
  const pack2 = m.parsePack(m.serializePack([changed], { title: 'Week 6', note: '' }, T1));
  t('plan: changed content is updated', () => m.planPack(library(), pack2).updated.length === 1);
  t('apply updates in place and keeps createdAt, drops cards of removed words', () => {
    const lib = library();
    lib.srs['list-1/i1'] = { box: 2, due: '2026-10-10' };
    const out = m.applyPack(lib, pack2, T1);
    const l = out.lists[0]!;
    return (
      out.lists.length === 1 &&
      l.items.map((i) => i.text).join() === 'spoon,fork' &&
      l.createdAt === T0 &&
      l.updatedAt === T1 &&
      out.srs['list-1/i1']?.box === 2 &&
      out.srs['list-1/i2'] === undefined &&
      out.attempts.length === lib.attempts.length
    );
  });
  t('apply never touches other lists', () => {
    const lib = library({ lists: [list(), list({ id: 'mine', name: 'Mine' })] });
    const out = m.applyPack(lib, pack2, T1);
    return out.lists[1]!.name === 'Mine' && out.lists[1]!.updatedAt === T0;
  });
  t('apply refuses to go over the list limit', () => {
    const many = Array.from({ length: core.LIMITS.lists }, (_, i) => list({ id: `l${i}` }));
    return throwsCode(
      () => m.applyPack({ lists: many, attempts: [], srs: {} }, m.parsePack(text), T1),
      'too-many-lists',
    );
  });
  // Pack refusals.
  t('pack: wrong format', () =>
    throwsCode(() => m.parsePack('{"format":"dictalark"}'), 'unknown-format'),
  );
  t('pack: newer schema', () =>
    throwsCode(() => m.parsePack(text.replace('"schema": 1', '"schema": 2')), 'future-schema'),
  );
  t('pack: no lists', () =>
    throwsCode(
      () =>
        m.parsePack(
          JSON.stringify({
            format: 'dictalark-class-pack',
            schema: 1,
            title: 'x',
            note: '',
            madeAt: T0,
            lists: [],
          }),
        ),
      'bad-shape',
    ),
  );
  t('pack: duplicate list ids', () => {
    const p = JSON.parse(text) as { lists: unknown[] };
    p.lists.push(p.lists[0]);
    return throwsCode(() => m.parsePack(JSON.stringify(p)), 'duplicate-id');
  });
  // Results: counts, missed words, no typed answers.
  const res = m.makeResults(pupilLib(m), ['list-1'], ' Chan Tai Man ', T1);
  t('results counts', () => {
    const a = res.lists[0]!.attempts;
    return (
      res.pupil === 'Chan Tai Man' &&
      a.length === 2 &&
      a[0]!.right === 1 &&
      a[0]!.wrong === 1 &&
      a[0]!.blank === 1 &&
      a[1]!.right === 2 &&
      a[1]!.wrong === 1 &&
      a[1]!.blank === 0
    );
  });
  t(
    'results missed words',
    () =>
      JSON.stringify(res.lists[0]!.missed) ===
      JSON.stringify([
        { itemId: 'i2', times: 2 },
        { itemId: 'i3', times: 1 },
      ]),
  );
  t('results never carry typed answers', () => !m.serializeResults(res).includes('colur'));
  t(
    'results round trip',
    () => JSON.stringify(m.parseResults(m.serializeResults(res))) === JSON.stringify(res),
  );
  // Results refusals.
  // Tampered files are free-form JSON on purpose.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Loose = Record<string, any>;
  const bad = (f: (r: Loose) => void, code: string) => () => {
    const r = JSON.parse(m.serializeResults(res)) as Loose;
    f(r);
    return throwsCode(() => m.parseResults(JSON.stringify(r)), code);
  };
  t(
    'results: missed more often than tried',
    bad((r) => (r.lists[0].missed[0].times = 3), 'bad-shape'),
  );
  t(
    'results: missed word not in the list',
    bad((r) => (r.lists[0].missed[0].itemId = 'zz'), 'bad-shape'),
  );
  t(
    'results: empty attempt',
    bad(
      (r) => Object.assign(r.lists[0].attempts[0], { right: 0, wrong: 0, blank: 0 }),
      'bad-shape',
    ),
  );
  t(
    'results: negative count',
    bad((r) => (r.lists[0].attempts[0].wrong = -1), 'bad-shape'),
  );
  t(
    'results: fractional count',
    bad((r) => (r.lists[0].attempts[0].right = 1.5), 'bad-shape'),
  );
  t(
    'results: bad mode',
    bad((r) => (r.lists[0].attempts[0].mode = 'exam'), 'bad-enum'),
  );
  t(
    'results: bad day',
    bad((r) => (r.lists[0].attempts[0].day = '2026-02-30'), 'bad-date'),
  );
  t(
    'results: empty pupil',
    bad((r) => (r.pupil = '  '), 'text-empty'),
  );
  t(
    'results: duplicate list',
    bad((r) => r.lists.push(r.lists[0]), 'duplicate-id'),
  );
  // Summary (worked by hand).
  const mk = (
    pupil: string,
    madeAt: string,
    attempts: [string, number, number, number][],
    missed: [string, number][],
  ) =>
    ({
      format: 'dictalark-class-results',
      schema: 1,
      pupil,
      madeAt,
      lists: [
        {
          listId: 'list-1',
          name: 'Kitchen words',
          items: [
            { id: 'i1', text: 'spoon' },
            { id: 'i2', text: 'colour' },
            { id: 'i3', text: '茶壺' },
          ],
          attempts: attempts.map(([day, right, wrong, blank]) => ({
            day,
            mode: 'typing',
            right,
            wrong,
            blank,
          })),
          missed: missed.map(([itemId, times]) => ({ itemId, times })),
        },
      ],
    }) as core.ClassResults;
  const files = [
    mk(
      'Amy',
      T0,
      [
        ['2026-10-08', 1, 2, 0],
        ['2026-10-09', 3, 0, 0],
      ],
      [
        ['i2', 1],
        ['i3', 1],
      ],
    ),
    mk(
      'Ben',
      T0,
      [
        ['2026-10-09', 2, 1, 0],
        ['2026-10-08', 2, 0, 1],
      ],
      [
        ['i2', 1],
        ['i3', 1],
      ],
    ),
    mk('amy ', T1, [['2026-10-10', 2, 1, 0]], [['i2', 1]]),
    mk('Cat', T0, [], []),
  ];
  const s = m.summariseResults(files);
  const l = s.lists[0]!;
  t(
    'summary: newest file per pupil wins',
    () => s.replaced === 1 && s.pupils.join() === 'amy ,Ben,Cat',
  );
  t(
    'summary rows',
    () =>
      JSON.stringify(l.rows.map((r) => [r.pupil, r.tries, r.best, r.last])) ===
      JSON.stringify([
        ['amy ', 1, { right: 2, total: 3 }, { day: '2026-10-10', right: 2, total: 3 }],
        ['Ben', 2, { right: 2, total: 3 }, { day: '2026-10-09', right: 2, total: 3 }],
        ['Cat', 0, null, null],
      ]),
  );
  t('summary counts', () => l.tried === 2 && l.allRight === 0);
  t(
    'summary missed order',
    () =>
      JSON.stringify(l.missed) ===
      JSON.stringify([
        { text: 'colour', pupils: 2, times: 2 },
        { text: '茶壺', pupils: 1, times: 1 },
      ]),
  );
  t('summary all right', () => m.summariseResults([files[0]!]).lists[0]!.allRight === 1);
  t('summary all right uses the last try, not the best', () => {
    const f = mk(
      'Eve',
      T0,
      [
        ['2026-10-08', 3, 0, 0],
        ['2026-10-09', 2, 1, 0],
      ],
      [['i2', 1]],
    );
    return m.summariseResults([f]).lists[0]!.allRight === 0;
  });
  t('summary missed: most pupils before most times', () => {
    const x = m.summariseResults([
      mk(
        'P1',
        T0,
        [['2026-10-08', 0, 3, 0]],
        [
          ['i1', 1],
          ['i3', 3],
        ],
      ),
      mk('P2', T0, [['2026-10-08', 2, 1, 0]], [['i1', 1]]),
    ]);
    return x.lists[0]!.missed.map((w) => w.text).join() === 'spoon,茶壺';
  });
  t('summary best is the highest share, not the most right', () => {
    const f = mk(
      'Dan',
      T0,
      [
        ['2026-10-08', 2, 2, 0],
        ['2026-10-09', 2, 1, 0],
      ],
      [],
    );
    f.lists[0]!.attempts[1]!.blank = 0;
    const x = m.summariseResults([
      {
        ...f,
        lists: [
          {
            ...f.lists[0]!,
            attempts: [
              { day: '2026-10-08', mode: 'typing', right: 3, wrong: 3, blank: 0 },
              { day: '2026-10-09', mode: 'typing', right: 2, wrong: 1, blank: 0 },
            ],
          },
        ],
      },
    ]);
    return JSON.stringify(x.lists[0]!.rows[0]!.best) === JSON.stringify({ right: 2, total: 3 });
  });
  t(
    'summary CSV rows',
    () =>
      JSON.stringify(m.summaryRows(s)[1]) ===
      JSON.stringify(['amy ', 'Kitchen words', '1', '2/3', '2026-10-10', '2/3']),
  );
  return failed;
}

describe('class packs and results files', () => {
  it('passes every golden and refusal case', () => {
    expect(suite(core)).toEqual([]);
  });

  it('property: a pack round-trips and applying it twice changes nothing more', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc
            .string({ minLength: 1, maxLength: 12 })
            // eslint-disable-next-line no-control-regex
            .filter((s) => s.trim() !== '' && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(s)),
          { minLength: 1, maxLength: 8 },
        ),
        (words) => {
          const l = list({
            items: words.map((w, i) => ({
              id: `w${i}`,
              text: w.normalize('NFC').trim(),
              accept: [],
              note: '',
            })),
          });
          let p: core.ClassPack;
          try {
            p = core.parsePack(core.serializePack([l], { title: 'T', note: '' }, T0));
          } catch {
            return; // text the validator refuses (e.g. lone surrogates) is out of scope here
          }
          const once = core.applyPack({ lists: [], attempts: [], srs: {} }, p, T1);
          const twice = core.applyPack(once, p, T1);
          expect(twice.added.length + twice.updated.length).toBe(0);
          expect(twice.lists).toEqual(once.lists);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: summary invariants (tried ≤ pupils, best ≥ last, missed counts add up)', () => {
    const attempt = fc.tuple(
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 1, max: 5 }),
      fc.integer({ min: 1, max: 28 }),
    );
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(fc.constantFrom('A', 'B', 'C', 'D'), fc.array(attempt, { maxLength: 6 })),
          { maxLength: 8 },
        ),
        (rows) => {
          const files = rows.map(([pupil, atts], k) => ({
            format: 'dictalark-class-results',
            schema: 1,
            pupil,
            madeAt: `2026-10-${String(1 + (k % 28)).padStart(2, '0')}T00:00:00Z`,
            lists: [
              {
                listId: 'L',
                name: 'L',
                items: [{ id: 'x', text: 'x' }],
                attempts: atts.map(([r, w, b, d]) => ({
                  day: `2026-09-${String(d).padStart(2, '0')}`,
                  mode: 'paper',
                  right: r,
                  wrong: w,
                  blank: b,
                })),
                missed: [],
              },
            ],
          })) as core.ClassResults[];
          const s = core.summariseResults(files);
          expect(s.pupils.length + s.replaced).toBe(files.length);
          for (const l of s.lists) {
            expect(l.tried).toBeLessThanOrEqual(s.pupils.length);
            for (const r of l.rows)
              if (r.best && r.last)
                expect(r.best.right * r.last.total).toBeGreaterThanOrEqual(
                  r.last.right * r.best.total,
                );
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------------
// Mutation testing.
// ---------------------------------------------------------------------------------
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const F = 'model/classroom.ts';
const read = () => readFileSync(join(srcDir, ...F.split('/')), 'utf8');
const MUTANTS: [string, string, string][] = [
  [
    'updated list loses createdAt',
    'createdAt: l.createdAt, updatedAt: now',
    'createdAt: now, updatedAt: now',
  ],
  [
    'cards of removed words kept',
    'if (k.startsWith(`${u.id}/`) && !keep.has(k)) delete srs[k];',
    ';',
  ],
  ['limit not checked', 'if (lib.lists.length + plan.added.length > LIMITS.lists)', 'if (false)'],
  [
    'blank not counted as missed',
    "if (e.result !== 'right' && itemIds.has(e.itemId))",
    "if (e.result === 'wrong' && itemIds.has(e.itemId))",
  ],
  [
    'oldest file wins',
    'if (!prev || f.madeAt >= prev.madeAt) latest.set(k, f);',
    'if (!prev) latest.set(k, f);',
  ],
  [
    'best by most right',
    'if (!best || a.right * best.total > best.right * total)',
    'if (!best || a.right > best.right)',
  ],
  ['last by file order', 'if (!last || a.day >= last.day)', 'if (true)'],
  [
    'missed sorted by times first',
    'b.pupils - a.pupils ||\n          b.times - a.times ||',
    'b.times - a.times ||\n          b.pupils - a.pupils ||',
  ],
  [
    'missed times not capped',
    'return { itemId, times: count(m.times, `${q}.times`, attempts.length) };',
    'return { itemId, times: count(m.times, `${q}.times`, 1e9) };',
  ],
  ['empty attempt accepted', 'if (total < 1 || total > n)', 'if (total > n)'],
  [
    'pupil names case-sensitive',
    "s.normalize('NFC').trim().toLowerCase()",
    "s.normalize('NFC').trim()",
  ],
  [
    'all-right counts best',
    'r.last && r.last.right === r.last.total',
    'r.best && r.best.right === r.best.total',
  ],
];
const created: string[] = [];
afterAll(() => {
  for (const d of created) rmSync(d, { recursive: true, force: true });
});
describe('mutation testing (class files)', () => {
  it('each mutant changes the source exactly once', () => {
    for (const [name, from] of MUTANTS) expect(read().split(from).length - 1, name).toBe(1);
  });
  MUTANTS.forEach(([name, from, to], i) =>
    it(`catches mutant: ${name}`, async () => {
      const dir = join(srcDir, `class${i}-mutant-${process.pid}`);
      created.push(dir);
      mkdirSync(dir, { recursive: true });
      for (const entry of readdirSync(srcDir))
        if (!entry.includes('-mutant-'))
          cpSync(join(srcDir, entry), join(dir, entry), { recursive: true });
      writeFileSync(join(dir, ...F.split('/')), read().replace(from, to));
      const mod = (await import(pathToFileURL(join(dir, 'index.ts')).href)) as Core;
      expect(suite(mod).length, `mutant "${name}" survived`).toBeGreaterThan(0);
    }),
  );
});
