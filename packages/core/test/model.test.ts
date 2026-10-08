// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  DictalarkError,
  ERROR_MESSAGES,
  errorMessage,
  findDuplicates,
  LIMITS,
  mergeLibrary,
  migrate,
  parseLibrary,
  safeJsonParse,
  SCHEMA_VERSION,
  serializeLibrary,
  validateDay,
  validateLang,
  validateList,
  validateText,
  type ErrorCode,
} from '../src/index';
import { library, list, T0 } from './helpers/fixtures';

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof DictalarkError ? e.code : `other: ${String(e)}`;
  }
  return 'no error';
};
const exportText = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ ...JSON.parse(serializeLibrary(library(), T0)), ...over });

describe('library JSON round trip', () => {
  it('serialise → parse returns the same library', () => {
    const lib = library();
    const back = parseLibrary(serializeLibrary(lib, T0));
    expect(back).toEqual({ ...lib, exportedAt: T0 });
  });
  it('unknown keys are dropped, not carried along', () => {
    const raw = JSON.parse(serializeLibrary(library(), T0));
    raw.lists[0].evil = 'x';
    raw.lists[0].items[0].onclick = 'alert(1)';
    const back = parseLibrary(JSON.stringify(raw));
    expect(back.lists[0]).not.toHaveProperty('evil');
    expect(back.lists[0]!.items[0]).not.toHaveProperty('onclick');
  });
  it('text is NFC-normalised and trimmed on the way in', () => {
    const l = validateList(list({ name: '  cafe\u0301  ' }));
    expect(l.name).toBe('café');
  });
});

describe('hostile JSON is rejected', () => {
  it.each<[string, () => string, ErrorCode]>([
    [
      '__proto__ key',
      () => exportText().replace('"lists"', '"__proto__":{"polluted":1},"lists"'),
      'forbidden-key',
    ],
    [
      'constructor key',
      () => exportText({ constructor: { prototype: { x: 1 } } }),
      'forbidden-key',
    ],
    ['nested prototype key', () => exportText({ srs: { prototype: 1 } }), 'forbidden-key'],
    ['depth 1,000', () => '['.repeat(1000) + ']'.repeat(1000), 'too-deep'],
    [
      'depth 100,000 (stack-overflow attempt)',
      () => '['.repeat(100_000) + ']'.repeat(100_000),
      'too-deep',
    ],
    [
      '10 MB string',
      () => JSON.stringify({ format: 'dictalark', x: 'a'.repeat(10 * 1024 * 1024) }),
      'too-large',
    ],
    ['NaN literal', () => '{"format":"dictalark","schema":NaN}', 'bad-json'],
    ['1e999 (Infinity)', () => '{"format":"dictalark","schema":1e999}', 'bad-number'],
    ['truncated file', () => exportText().slice(0, 50), 'bad-json'],
    ['not our format', () => JSON.stringify({ format: 'other', schema: 1 }), 'unknown-format'],
    ['array at top', () => '[]', 'unknown-format'],
    ['missing schema', () => exportText({ schema: undefined }), 'missing-schema'],
    ['future schema', () => exportText({ schema: SCHEMA_VERSION + 1 }), 'future-schema'],
    ['schema as string', () => exportText({ schema: '1' }), 'bad-shape'],
  ])('%s', (_name, make, expected) => {
    expect(code(() => parseLibrary(make()))).toBe(expected);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('duplicate list ids', () => {
    const lib = library({ lists: [list(), list()] });
    expect(code(() => parseLibrary(serializeLibrary(lib, T0)))).toBe('duplicate-id');
  });
  it('duplicate item ids inside a list', () => {
    const l = list();
    l.items[1]!.id = l.items[0]!.id;
    expect(code(() => validateList(l))).toBe('duplicate-id');
  });
  it('duplicate attempt ids', () => {
    const lib = library();
    lib.attempts.push({ ...lib.attempts[0]! });
    expect(code(() => parseLibrary(serializeLibrary(lib, T0)))).toBe('duplicate-id');
  });
  it('ids with odd characters (HTML, path, spaces)', () => {
    for (const id of ['<b>', '../x', 'a b', '', 'x'.repeat(65)])
      expect(code(() => validateList(list({ id })))).toBe('bad-id');
  });
  it('more than 200 lists', () => {
    const lists = Array.from({ length: LIMITS.lists + 1 }, (_, i) => list({ id: `l${i}` }));
    expect(code(() => parseLibrary(serializeLibrary(library({ lists }), T0)))).toBe(
      'too-many-lists',
    );
  });
  it('more than 200 items in a list', () => {
    const items = Array.from({ length: LIMITS.itemsPerList + 1 }, (_, i) => ({
      id: `i${i}`,
      text: `w${i}`,
      accept: [],
      note: '',
    }));
    expect(code(() => validateList(list({ items })))).toBe('too-many-items');
  });
  it('an SRS box outside 1–5 and a bad due date', () => {
    expect(
      code(() => parseLibrary(exportText({ srs: { 'list-1/i1': { box: 6, due: '2026-10-08' } } }))),
    ).toBe('bad-enum');
    expect(
      code(() => parseLibrary(exportText({ srs: { 'list-1/i1': { box: 1, due: '2026-02-30' } } }))),
    ).toBe('bad-date');
  });
  it('an attempt with an unknown result value', () => {
    const raw = JSON.parse(exportText());
    raw.attempts[0].entries[0].result = 'maybe';
    expect(code(() => parseLibrary(JSON.stringify(raw)))).toBe('bad-enum');
  });
  it('"|" inside one accepted answer is refused (it separates answers in CSV)', () => {
    const l = list();
    l.items[0]!.accept = ['a|b'];
    expect(code(() => validateList(l))).toBe('bad-shape');
  });
  it('safeJsonParse refuses the size before reading', () => {
    expect(code(() => safeJsonParse('"' + 'a'.repeat(LIMITS.importBytes) + '"'))).toBe('too-large');
  });
});

describe('field validation', () => {
  it.each([
    ['', 'text-empty'],
    ['   ', 'text-empty'],
    ['a\u0000b', 'text-control-char'],
    ['a\tb', 'text-control-char'],
    ['a\u2028b', 'text-control-char'],
    ['a\ud800b', 'text-control-char'],
    ['x'.repeat(121), 'text-too-long'],
  ])('text %j → %s', (t, expected) => {
    expect(code(() => validateText(t, 'x'))).toBe(expected);
  });
  it('accepts emoji, combining marks, RTL and CJK extension B', () => {
    for (const t of ['👩‍👩‍👧', 'e\u0301', 'שלום', '𠮷野家', '默書 雲雀 羣'])
      expect(validateText(t, 'x')).toBe(t.normalize('NFC'));
  });
  it.each([
    ['en-gb', 'en-GB'],
    ['yue-HK', 'yue-HK'],
    ['zh-hk', 'zh-HK'],
    ['cmn-Hans-CN', 'zh-Hans-CN'], // Intl canonicalises the cmn alias to zh
  ])('language %s → %s', (tag, canon) => expect(validateLang(tag, 'x')).toBe(canon));
  it.each(['english', 'e', 'en_GB', 'en-', '<script>', 'x'.repeat(40)])('bad language %s', (t) =>
    expect(code(() => validateLang(t, 'x'))).toBe('bad-lang'),
  );
  it.each(['2026-02-29', '2026-13-01', '2026-00-10', '1999-12-31', '2026-1-1', '2026-04-31'])(
    'bad day %s',
    (d) => expect(code(() => validateDay(d, 'x'))).toBe('bad-date'),
  );
  it('leap day 2028-02-29 is fine', () =>
    expect(validateDay('2028-02-29', 'x')).toBe('2028-02-29'));
  it('timestamps must be real UTC times', () => {
    const l = (createdAt: string) => code(() => validateList(list({ createdAt })));
    expect(l('2026-10-08T24:00:00Z')).toBe('bad-date');
    expect(l('2026-10-08T10:00:00+08:00')).toBe('bad-date');
    expect(l('2026-10-08T10:00:00.123Z')).toBe('no error');
  });
});

describe('migrations', () => {
  it('current schema passes through unchanged', () => {
    const d = { schema: SCHEMA_VERSION, lists: [] };
    expect(migrate(d)).toEqual(d);
  });
  it('runs each step in order (framework test with an injected table)', () => {
    const out = migrate(
      { schema: 1, words: ['a'] },
      {
        target: 3,
        migrations: {
          1: (d) => ({ ...d, items: d.words, words: undefined }),
          2: (d) => ({ ...d, upgraded: true }),
        },
      },
    );
    expect(out).toEqual({ schema: 3, items: ['a'], words: undefined, upgraded: true });
  });
  it('a missing step is an error, never a silent pass', () => {
    expect(code(() => migrate({ schema: 1 }, { target: 2, migrations: {} }))).toBe('bad-shape');
  });
});

describe('duplicates', () => {
  it('flags case and spacing variants of English words', () => {
    expect(findDuplicates(['Receive', 'spoon', 'receive ', 'fork', 'spoon'])).toEqual([
      [0, 2],
      [1, 4],
    ]);
  });
  it('flags composed and decomposed é as the same word', () => {
    expect(findDuplicates(['café', 'cafe\u0301'])).toEqual([[0, 1]]);
  });
  it('does NOT merge different Chinese characters (羣 / 群)', () => {
    expect(findDuplicates(['羣', '群'])).toEqual([]);
  });
});

describe('error messages', () => {
  it('every error code has English and Chinese text', () => {
    for (const [c, m] of Object.entries(ERROR_MESSAGES)) {
      const e = new DictalarkError(c as ErrorCode, { max: 2, path: 'p', expected: 'e', key: 'k' });
      expect(errorMessage(e, 'en').length, c).toBeGreaterThan(5);
      expect(errorMessage(e, 'zh-HK'), c).toMatch(/[\u4e00-\u9fff]/);
      expect(m.en).not.toBe(m['zh-HK']);
    }
  });
});

describe('mergeLibrary (importing a backup)', () => {
  const ids = (prefix: string) => {
    let n = 0;
    return () => `${prefix}${++n}`;
  };

  it('adds lists without touching existing ones', () => {
    const base = library();
    const incoming = library({
      lists: [list({ id: 'other', name: 'Other' })],
      attempts: [],
      srs: { 'other/i1': { box: 3, due: '2026-10-11' } },
    });
    const out = mergeLibrary(base, incoming, ids('n'));
    expect(out.lists.map((l) => l.id)).toEqual(['list-1', 'other']);
    expect(out.srs['other/i1']).toEqual({ box: 3, due: '2026-10-11' });
    expect(out.srs['list-1/i2']).toEqual(base.srs['list-1/i2']);
  });

  it('re-ids a colliding list and moves its attempts and review cards with it', () => {
    const base = library();
    const incoming = library({ srs: { 'list-1/i1': { box: 4, due: '2026-10-20' } } });
    const out = mergeLibrary(base, incoming, ids('fresh'));
    expect(out.lists.map((l) => l.id)).toEqual(['list-1', 'fresh1']);
    // The existing schedule is not overwritten by the import.
    expect(out.srs['list-1/i2']).toEqual({ box: 1, due: '2026-10-08' });
    expect(out.srs['list-1/i1']).toBeUndefined();
    expect(out.srs['fresh1/i1']).toEqual({ box: 4, due: '2026-10-20' });
    expect(out.attempts.map((a) => [a.id, a.listId])).toEqual([
      ['a1', 'list-1'],
      ['fresh2', 'fresh1'],
    ]);
    // The inputs are not mutated.
    expect(base.lists).toHaveLength(1);
    expect(incoming.lists[0]!.id).toBe('list-1');
  });

  it('skips ids that are already taken when making new ones', () => {
    const base = library({ lists: [list(), list({ id: 'n1' })] });
    const out = mergeLibrary(base, library({ attempts: [], srs: {} }), ids('n'));
    expect(out.lists.map((l) => l.id)).toEqual(['list-1', 'n1', 'n2']);
  });

  it('drops orphan attempts and review cards from the import', () => {
    const incoming = library({
      lists: [list({ id: 'x' })],
      attempts: [{ id: 'z', listId: 'ghost', day: '2026-10-08', mode: 'paper', entries: [] }],
      srs: { 'ghost/i1': { box: 2, due: '2026-10-09' } },
    });
    const out = mergeLibrary(library({ lists: [], attempts: [], srs: {} }), incoming, ids('n'));
    expect(out.attempts).toEqual([]);
    expect(out.srs).toEqual({});
  });

  it('refuses to go over the list limit', () => {
    const many = Array.from({ length: LIMITS.lists }, (_, i) => list({ id: `l${i}` }));
    expect(() =>
      mergeLibrary(library({ lists: many, attempts: [], srs: {} }), library(), ids('n')),
    ).toThrow(DictalarkError);
  });
});
