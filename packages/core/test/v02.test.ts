// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2 features: spoken-text override, full backups with recordings (and v0.1 files),
// share links, passage splitting, punctuation names, chosen voices.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  decodeShare,
  DictalarkError,
  encodeShare,
  importTable,
  LIMITS,
  listToCsv,
  mergeLibraryWithIds,
  parseBackup,
  parsePunctuationNames,
  pickVoice,
  serializeBackup,
  serializeLibrary,
  speakPunctuation,
  splitPassage,
  validateItem,
  type BackupRecording,
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

const rec = (over: Partial<BackupRecording> = {}): BackupRecording => ({
  listId: 'list-1',
  itemId: 'i1',
  mime: 'audio/webm;codecs=opus',
  ms: 1500,
  data: new Uint8Array([1, 2, 3, 250, 0, 7]),
  ...over,
});

describe('base64 (strict)', () => {
  it('round-trips any bytes, standard and URL-safe', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 300 }), (b) => {
        expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
        expect(base64UrlToBytes(bytesToBase64Url(b))).toEqual(b);
        expect(bytesToBase64Url(b)).toMatch(/^[A-Za-z0-9_-]*$/);
      }),
      { numRuns: 500 },
    );
  });
  it.each(['QQ', 'QR==', 'QQ== ', ' QQ==', 'Q Q==', 'QQ=\n=', 'Q===', '*AAA'])(
    'refuses non-canonical or dirty input %j',
    (s) => {
      expect(code(() => base64ToBytes(s))).toBe('bad-shape');
    },
  );
  it('refuses a URL-safe string of impossible length', () => {
    expect(code(() => base64UrlToBytes('A'))).toBe('bad-shape');
    expect(code(() => base64UrlToBytes('AB+C'))).toBe('bad-shape');
  });
});

describe('spoken text override ("read as")', () => {
  it('is kept when different from the word, dropped when empty or the same', () => {
    expect(validateItem({ id: 'a', text: '放假', say: '放價' }, 'x').say).toBe('放價');
    expect(validateItem({ id: 'a', text: '放假', say: '' }, 'x').say).toBeUndefined();
    expect(validateItem({ id: 'a', text: '放假', say: ' 放假 ' }, 'x').say).toBeUndefined();
    expect(code(() => validateItem({ id: 'a', text: '放假', say: 5 }, 'x'))).toBe('bad-shape');
    expect(code(() => validateItem({ id: 'a', text: '放假', say: 'a\u0007' }, 'x'))).toBe(
      'text-control-char',
    );
  });
  it('travels through CSV export → import', () => {
    const l = list({
      items: [
        { id: 'a', text: '放假', accept: [], note: '', say: '放價' },
        { id: 'b', text: 'read', accept: [], note: 'past tense', say: 'red' },
        { id: 'c', text: 'plain', accept: [], note: '' },
      ],
    });
    const back = importTable(listToCsv(l)).items;
    expect(back.map((i) => i.say)).toEqual(['放價', 'red', undefined]);
  });
  it('a 讀法 column is recognised in Chinese', () => {
    expect(importTable('詞語,讀法\n放假,放價\n').items[0]!.say).toBe('放價');
  });
});

describe('full backup with recordings (schema 2)', () => {
  it('round-trips library and recordings', () => {
    const lib = library();
    const recs = [
      rec(),
      rec({ itemId: 'i3', mime: 'audio/mp4', data: new Uint8Array(1000).fill(9) }),
    ];
    const back = parseBackup(serializeBackup(lib, recs, T0));
    expect(back.lists).toEqual(lib.lists);
    expect(back.attempts).toEqual(lib.attempts);
    expect(back.recordings).toEqual(recs);
  });
  it('property: any recordings of existing items survive byte for byte', () => {
    fc.assert(
      fc.property(
        fc.subarray(['i1', 'i2', 'i3']),
        fc.uint8Array({ minLength: 1, maxLength: 200 }),
        fc.integer({ min: 0, max: 31_000 }),
        (ids, bytes, ms) => {
          const recs = ids.map((itemId) => rec({ itemId, data: bytes, ms }));
          expect(parseBackup(serializeBackup(library(), recs, T0)).recordings).toEqual(recs);
        },
      ),
      { numRuns: 200 },
    );
  });
  it('a fractional recording length (browser clock) is saved as whole milliseconds', () => {
    const back = parseBackup(serializeBackup(library(), [rec({ ms: 1500.7 })], T0));
    expect(back.recordings[0]!.ms).toBe(1501);
  });
  it('recordings of items that no longer exist are left out of the file', () => {
    const text = serializeBackup(library(), [rec({ itemId: 'gone' }), rec()], T0);
    expect(parseBackup(text).recordings.map((r) => r.itemId)).toEqual(['i1']);
  });
  it('a v0.1 backup (schema 1, no recordings) still imports', () => {
    const v01 = JSON.stringify({ ...JSON.parse(serializeLibrary(library(), T0)), schema: 1 });
    const back = parseBackup(v01);
    expect(back.lists).toEqual(library().lists);
    expect(back.recordings).toEqual([]);
  });
  const withRecs = (recordings: unknown) =>
    JSON.stringify({ ...JSON.parse(serializeLibrary(library(), T0)), recordings });
  const good = { listId: 'list-1', itemId: 'i1', mime: 'audio/webm', ms: 100, data: 'AQID' };
  it.each([
    ['not an array', {}, 'bad-shape'],
    ['an item not in the file', [{ ...good, itemId: 'nope' }], 'bad-shape'],
    ['a list not in the file', [{ ...good, listId: 'nope' }], 'bad-shape'],
    ['the same item twice', [good, good], 'duplicate-id'],
    ['a non-audio type', [{ ...good, mime: 'text/html' }], 'bad-shape'],
    ['a type with extra parameters', [{ ...good, mime: 'audio/webm;x=<script>' }], 'bad-shape'],
    ['negative length', [{ ...good, ms: -1 }], 'bad-shape'],
    ['fractional length', [{ ...good, ms: 1.5 }], 'bad-shape'],
    ['over 31 s', [{ ...good, ms: 31_001 }], 'recording-too-long'],
    ['empty audio', [{ ...good, data: '' }], 'recording-empty'],
    ['broken base64', [{ ...good, data: 'AQ=D' }], 'bad-shape'],
    ['bad id', [{ ...good, listId: '../x' }], 'bad-id'],
    ['prototype key', [{ ...good, __proto__x: 1, constructor: 1 }], 'forbidden-key'],
  ])('refuses recordings: %s', (_name, recordings, expected) => {
    expect(code(() => parseBackup(withRecs(recordings)))).toBe(expected);
  });
  it('refuses one recording larger than the per-recording limit before decoding it', () => {
    const big = 'A'.repeat(Math.ceil(LIMITS.recordingBytesEach / 3) * 4 + 4);
    expect(code(() => parseBackup(withRecs([{ ...good, data: big }])))).toBe('too-large');
  });
  it('merging renames a clashing list and tells where its recordings go', () => {
    const base = library();
    const incoming = parseBackup(serializeBackup(library(), [rec()], T0));
    let n = 0;
    const { lib, listIds } = mergeLibraryWithIds(base, incoming, () => `new-${++n}`);
    expect(lib.lists).toHaveLength(2);
    const to = listIds.get('list-1');
    expect(to).toBe('new-1');
    expect(lib.lists[1]!.id).toBe(to);
    expect(lib.lists[1]!.items.map((i) => i.id)).toContain('i1');
  });
});

describe('share links', () => {
  let n = 0;
  const newId = () => `id${++n}`;
  it('carry the list (not results, recordings or review state) and come back equal', () => {
    const l = list({
      items: [
        { id: 'a', text: '放假', accept: ['放暇'], note: '假期', say: '放價', lang: 'yue-HK' },
        { id: 'b', text: 'colour', accept: ['color'], note: '' },
      ],
    });
    const back = decodeShare(encodeShare(l), newId, T0);
    expect(back.name).toBe(l.name);
    const strip = (items: readonly { id: string }[]) =>
      items.map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => k !== 'id')));
    expect(strip(back.items)).toEqual(strip(l.items));
    expect(back.items.every((i) => i.id.startsWith('id'))).toBe(true);
    expect(Object.keys(back).sort()).toEqual(
      ['createdAt', 'id', 'items', 'lang', 'name', 'subject', 'updatedAt'].sort(),
    );
  });
  it('property: any valid list survives a share link', () => {
    const text = fc
      .string({ minLength: 1, maxLength: 20, unit: 'grapheme' })
      // eslint-disable-next-line no-control-regex
      .map((s) => s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029|]/g, '').trim())
      .filter((s) => s.length > 0);
    fc.assert(
      fc.property(
        fc.array(text, { minLength: 1, maxLength: 15 }),
        fc.option(text),
        (words, say) => {
          const l = list({
            items: words.map((w, i) => ({
              id: `w${i}`,
              text: w.normalize('NFC'),
              accept: [],
              note: '',
              ...(say && say.normalize('NFC') !== w.normalize('NFC')
                ? { say: say.normalize('NFC') }
                : {}),
            })),
          });
          const back = decodeShare(encodeShare(l), newId, T0);
          expect(back.items.map((i) => [i.text, i.say])).toEqual(
            l.items.map((i) => [i.text, i.say]),
          );
        },
      ),
      { numRuns: 300 },
    );
  });
  it.each([
    ['not base64url', 'abc$', 'bad-shape'],
    ['not JSON', bytesToBase64Url(new TextEncoder().encode('hello')), 'bad-json'],
    [
      'wrong version',
      bytesToBase64Url(new TextEncoder().encode('{"v":2,"i":[]}')),
      'unknown-format',
    ],
    [
      'prototype key',
      bytesToBase64Url(new TextEncoder().encode('{"v":1,"__proto__":{},"i":[]}')),
      'forbidden-key',
    ],
    [
      'bad item',
      bytesToBase64Url(
        new TextEncoder().encode('{"v":1,"n":"x","s":"english","l":"en-GB","i":[{"t":""}]}'),
      ),
      'text-empty',
    ],
    ['too long', 'A'.repeat(LIMITS.shareChars + 4), 'too-large'],
    ['invalid UTF-8', bytesToBase64Url(new Uint8Array([0xff, 0xfe])), 'not-utf8'],
  ])('refuses a tampered link: %s', (_n, c, expected) => {
    expect(code(() => decodeShare(c, newId, T0))).toBe(expected);
  });
  it('refuses to make a link that would be too long', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({
      id: `w${i}`,
      text: `${i}${'長'.repeat(100)}`,
      accept: [],
      note: '',
    }));
    expect(code(() => encodeShare(list({ items })))).toBe('too-large');
  });
});

describe('passage splitting', () => {
  it.each([
    ['今天天氣很好，我們去公園玩。你去嗎？', ['今天天氣很好，', '我們去公園玩。', '你去嗎？']],
    ['「你好！」他說。', ['「你好！」', '他說。']],
    ['Pi is 3.14, not 1,000. Right?!', ['Pi is 3.14,', 'not 1,000.', 'Right?!']],
    ['The U.S.A. is big.', ['The U.S.A.', 'is big.']],
    ['等一等……好', ['等一等……', '好']],
    ['no punctuation at all', ['no punctuation at all']],
    ['', []],
    ['，。', ['，。']],
  ])('%j', (text, parts) => {
    expect(splitPassage(text)).toEqual(parts);
  });
  it('property: nothing is lost or added, and no part is empty', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            '天',
            '氣',
            'a',
            'b',
            '1',
            ' ',
            '，',
            '。',
            '.',
            ',',
            '！',
            '」',
            '「',
            '?',
            '…',
          ),
          {
            maxLength: 60,
          },
        ),
        (chars) => {
          const text = chars.join('');
          const parts = splitPassage(text);
          expect(parts.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''));
          for (const p of parts) expect(p.trim()).toBe(p);
          for (const p of parts) expect(p.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('punctuation names', () => {
  it('custom names replace the built-in ones', () => {
    const o = parsePunctuationNames('！ = 感歎號\n# comment\n\n」=引號完');
    expect(speakPunctuation('好！」', 'yue-HK', o)).toBe('好 感歎號 引號完');
    expect(speakPunctuation('好！', 'yue-HK')).toBe('好 感嘆號');
  });
  it('English commas are read, not dropped', () => {
    expect(speakPunctuation('Yes, please.', 'en-GB')).toBe('Yes comma please full stop');
  });
  it('a custom name works even for a language without a built-in table', () => {
    expect(speakPunctuation('Oui, merci', 'fr-FR', { ',': 'virgule' })).toBe('Oui virgule merci');
  });
  it.each([
    ['no equals sign', '！ 感歎號'],
    ['letters as the mark', 'ab = x'],
    ['empty name', '！ ='],
    ['name too long', `！ = ${'長'.repeat(21)}`],
    ['control character', '！ = a\u0007'],
  ])('refuses %s', (_n, text) => {
    expect(code(() => parsePunctuationNames(text))).toBe('bad-shape');
  });
  it('refuses more than 40 entries', () => {
    const many = Array.from({ length: 41 }, (_, i) => `${'!?.,;:@%&*'[i % 10]!} = n${i}`);
    expect(code(() => parsePunctuationNames(many.join('\n')))).toBe('too-many-items');
  });
});

describe('chosen voices', () => {
  const voices = [
    { name: 'A', lang: 'en-GB', localService: true },
    { name: 'B', lang: 'en-GB', localService: true },
    { name: 'C', lang: 'zh-HK', localService: true },
  ];
  it('a chosen voice wins over the automatic order, but never over the language', () => {
    expect(pickVoice(voices, 'en-GB').voice?.name).toBe('A');
    expect(pickVoice(voices, 'en-GB', { preferredNames: ['B'] }).voice?.name).toBe('B');
    expect(pickVoice(voices, 'yue-HK', { preferredNames: ['B'] }).voice?.name).toBe('C');
  });
});
