// SPDX-License-Identifier: AGPL-3.0-or-later
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  decodeUtf8,
  detectDelimiter,
  DictalarkError,
  guardFormula,
  importTable,
  itemsFromTable,
  LIMITS,
  listToCsv,
  parseCsv,
  stringifyCsv,
  unguardFormula,
  validateText,
  type WordList,
} from '../src/index';
import { list } from './helpers/fixtures';

const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e instanceof DictalarkError ? e.code : `other: ${String(e)}`;
  }
  return 'no error';
};

describe('CSV reader (golden)', () => {
  it.each<[string, string, string[][]]>([
    [
      'LF',
      'a,b\nc,d\n',
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ],
    [
      'CRLF',
      'a,b\r\nc,d\r\n',
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ],
    [
      'CR only',
      'a,b\rc,d',
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ],
    ['mixed line endings', 'a\r\nb\nc\rd', [['a'], ['b'], ['c'], ['d']]],
    ['UTF-8 BOM', '\ufefftext\nspoon\n', [['text'], ['spoon']]],
    ['quoted comma', '"a,b",c\n', [['a,b', 'c']]],
    ['quoted line break', '"line 1\nline 2",x\n', [['line 1\nline 2', 'x']]],
    ['quoted CRLF', '"a\r\nb"\n', [['a\r\nb']]],
    ['doubled quotes', '"say ""hi""",x\n', [['say "hi"', 'x']]],
    ['blank lines skipped', '\n\na\n\n\nb\n\n', [['a'], ['b']]],
    ['header only', 'text,note\n', [['text', 'note']]],
    ['ragged rows kept as they are', 'a,b,c\nd\ne,f\n', [['a', 'b', 'c'], ['d'], ['e', 'f']]],
    ['no final newline', 'a,b', [['a', 'b']]],
    ['quoted empty cell keeps the row', '""\n', [['']]],
    ['spaces are not trimmed', ' a , b \n', [[' a ', ' b ']]],
    ['Chinese full-width comma is not a separator', '默書，雲雀,x\n', [['默書，雲雀', 'x']]],
    ['empty input', '', []],
  ])('%s', (_name, text, rows) => {
    expect(parseCsv(text)).toEqual(rows);
  });

  it('TSV is detected and read', () => {
    const t = 'text\tnote\nsay, then write\tcomma inside\n';
    expect(detectDelimiter(t)).toBe('\t');
    expect(parseCsv(t)).toEqual([
      ['text', 'note'],
      ['say, then write', 'comma inside'],
    ]);
  });

  it('separators inside quotes do not fool detection', () => {
    expect(detectDelimiter('"a\tb\tc",d\n')).toBe(',');
  });

  it('an unclosed quote is a clear error, not silent data loss', () => {
    expect(code(() => parseCsv('a,"b\nc,d\n'))).toBe('csv-unterminated-quote');
  });

  it('files over the import limit are refused before parsing', () => {
    expect(code(() => parseCsv('a'.repeat(LIMITS.importBytes + 1)))).toBe('too-large');
  });
});

describe('encoding', () => {
  it('a Big5 file is refused with a "save as UTF-8" error instead of mojibake', () => {
    const big5 = new Uint8Array([0xa4, 0xa4, 0xa4, 0xe5, 0x0a]); // 「中文」 in Big5
    expect(new TextDecoder('big5').decode(big5)).toBe('中文\n'); // the fixture is genuine Big5
    expect(code(() => decodeUtf8(big5))).toBe('not-utf8');
  });
  it('UTF-8 with and without BOM decodes, BOM removed', () => {
    const enc = new TextEncoder();
    expect(decodeUtf8(enc.encode('默書'))).toBe('默書');
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('雲雀')]))).toBe('雲雀');
  });
  it('oversized byte arrays are refused', () => {
    expect(code(() => decodeUtf8(new Uint8Array(LIMITS.importBytes + 1)))).toBe('too-large');
  });
});

describe('formula injection', () => {
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx', "'=already"])(
    'neutralises %j on export',
    (v) => {
      const out = stringifyCsv([[v]]);
      const cell = parseCsv(out)[0]![0]!;
      expect(cell.startsWith("'")).toBe(true);
      expect(unguardFormula(cell)).toBe(v);
    },
  );
  it('leaves ordinary text alone', () => {
    for (const v of ["'tis", 'e-mail', 'a=b', '默書']) expect(guardFormula(v)).toBe(v);
  });
  it('no exported cell can start a formula (property)', () => {
    fc.assert(
      fc.property(fc.string(), (v) => {
        const cell = parseCsv(stringifyCsv([[v, 'x']]))[0]![0]!;
        expect(/^[=+\-@\t\r]/.test(cell)).toBe(false);
      }),
      { numRuns: 1000 },
    );
  });
});

const TRICKY = [
  ',',
  '"',
  '\n',
  '\r',
  '\r\n',
  '\t',
  ' ',
  '=',
  '+',
  '-',
  '@',
  "'",
  '|',
  'é',
  'e\u0301',
  '👩‍👩‍👧',
  '🇭🇰',
  'שלום',
  'مرحبا',
  '默',
  '羣',
  '𠮷',
  '\ufeff',
  '\u200b',
  'ß',
  'İ',
];
const cellArb = fc.string({
  unit: fc.oneof(fc.constantFrom(...TRICKY), fc.string({ unit: 'grapheme', maxLength: 1 })),
  maxLength: 12,
});

describe('CSV round trip (property)', () => {
  it('rows → CSV → rows is lossless (2,000 runs, both separators)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(cellArb, { minLength: 1, maxLength: 5 }), { maxLength: 6 }),
        fc.constantFrom<',' | '\t'>(',', '\t'),
        (rows, delim) => {
          const kept = rows.filter((r) => r.some((c) => c !== ''));
          const back = parseCsv(stringifyCsv(kept, delim), delim).map((r) => r.map(unguardFormula));
          expect(back).toEqual(kept);
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('word list → CSV → items is lossless (500 runs)', () => {
    const textArb = cellArb
      // eslint-disable-next-line no-control-regex
      .map((s) => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ''))
      .filter((s) => {
        try {
          return validateText(s, 'x') === s;
        } catch {
          return false;
        }
      });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            text: textArb,
            accept: fc.array(
              textArb.filter((s) => !s.includes('|')),
              { maxLength: 3 },
            ),
            note: fc.oneof(fc.constant(''), textArb),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (items) => {
          const l: WordList = list({ items: items.map((it, i) => ({ ...it, id: `i${i}` })) });
          const back = importTable(listToCsv(l));
          expect(back.hasHeader).toBe(true);
          expect(back.items).toEqual(items);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('table → items', () => {
  it('guesses Chinese and English headers and splits accepted answers', () => {
    const r = importTable('詞語,可接受答案,備註\ncolour,color | colour,UK\n默書,,\n');
    expect(r.hasHeader).toBe(true);
    expect(r.items).toEqual([
      { text: 'colour', accept: ['color', 'colour'], note: 'UK' },
      { text: '默書', accept: [], note: '' },
    ]);
  });
  it('a file without a header uses the first column', () => {
    expect(importTable('spoon\nfork\n').items.map((i) => i.text)).toEqual(['spoon', 'fork']);
  });
  it('rows with an empty word are skipped and reported by file row number', () => {
    const r = importTable('text,note\nspoon,\n,orphan note\nfork,\n');
    expect(r.items.map((i) => i.text)).toEqual(['spoon', 'fork']);
    expect(r.skippedRows).toEqual([3]);
  });
  it('a header-only file is "no words found"', () => {
    expect(code(() => importTable('text,note\n'))).toBe('csv-empty');
  });
  it('a mapping pointing past the last column is refused', () => {
    expect(code(() => itemsFromTable([['a'], ['b']], { text: 3 }, false))).toBe(
      'csv-no-text-column',
    );
  });
  it('more than 200 words is refused', () => {
    const text = Array.from({ length: LIMITS.itemsPerList + 1 }, (_, i) => `w${i}`).join('\n');
    expect(code(() => importTable(text))).toBe('too-many-items');
  });
  it('a word over 120 characters is refused with its row', () => {
    expect(code(() => importTable(`ok\n${'x'.repeat(121)}\n`))).toBe('text-too-long');
  });
  it('120 characters counted as code points (𠮷 counts once)', () => {
    expect(importTable('𠮷'.repeat(120)).items[0]!.text).toBe('𠮷'.repeat(120));
  });
  it('a bad language code in the lang column is refused', () => {
    expect(code(() => importTable('text,lang\nspoon,english!!\n'))).toBe('bad-lang');
  });
});
