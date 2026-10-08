// SPDX-License-Identifier: AGPL-3.0-or-later
// Golden marking table. Every expectation was worked out by hand from the rules in
// normalize/index.ts (distance = optimal string alignment over graphemes).
import type { RuleId } from '../../src/index';

export interface Case {
  name: string;
  expected: string;
  answer: string;
  correct: boolean;
  distance: number;
  accept?: string[];
  off?: RuleId[];
  forgiven?: RuleId[];
}

const c = (
  name: string,
  expected: string,
  answer: string,
  correct: boolean,
  distance: number,
  extra: Partial<Case> = {},
): Case => ({ name, expected, answer, correct, distance, ...extra });

export const CASES: Case[] = [
  // English basics
  c('exact', 'receive', 'receive', true, 0),
  c('swapped neighbours count once', 'receive', 'recieve', false, 1),
  c('capital first letter ignored', 'receive', 'Receive', true, 0, { forgiven: ['case'] }),
  c('all capitals ignored', 'receive', 'RECEIVE', true, 0),
  c('full-width letters', 'colour', 'ｃｏｌｏｕｒ', true, 0, { forgiven: ['fullwidth-alnum'] }),
  c('US spelling without an accepted answer', 'colour', 'color', false, 1),
  c('right single quote', "don't", 'don’t', true, 0, { forgiven: ['quotes'] }),
  c('left single quote', "don't", 'don‘t', true, 0),
  c('modifier apostrophe', "don't", 'donʼt', true, 0),
  c('missing apostrophe', "don't", 'dont', false, 1),
  c('minus sign U+2212', '-5', '−5', true, 0, { forgiven: ['dashes'] }),
  c('hyphen U+2010', 'well-known', 'well‐known', true, 0),
  c('em dash typed for a hyphen', 'well-known', 'well—known', true, 0),
  c('no-break space', 'ice cream', 'ice\u00a0cream', true, 0, { forgiven: ['spaces'] }),
  c('double space', 'ice cream', 'ice  cream', true, 0),
  c('spaces around', 'ice cream', ' ice cream ', true, 0),
  c('missing space', 'ice cream', 'icecream', false, 1),
  c('ideographic space', 'ice cream', 'ice\u3000cream', true, 0),
  c('final full stop optional', 'The cat sat.', 'the cat sat', true, 0, {
    forgiven: ['final-punct', 'case'],
  }),
  c('final question mark optional', 'Is it?', 'Is it', true, 0),
  c('final ?! both stripped', 'Is it?', 'Is it?!', true, 0),
  c('inner comma still counts', 'Hello, world.', 'Hello world', false, 1),
  c('Turkish dotted capital İ is not i', 'İstanbul', 'istanbul', false, 1),
  c('dotless ı is not i', 'ılık', 'ilik', false, 2),
  c('dotless ı is not I either', 'ılık', 'ILIK', false, 2),
  c('ß is not ss', 'straße', 'strasse', false, 2),
  c('capital ẞ equals ß', 'Straße', 'STRAẞE', true, 0),
  c('decomposed é equals é', 'café', 'cafe\u0301', true, 0),
  c('é equals decomposed expected', 'cafe\u0301', 'café', true, 0),
  c('missing accent', 'café', 'cafe', false, 1),
  c('missing diaeresis', 'naïve', 'naive', false, 1),
  c('missing last letter', 'receive', 'receiv', false, 1),
  c('extra last letter', 'receive', 'receivee', false, 1),
  c('blank answer', 'receive', '', false, 7),
  c('single letter', 'a', 'b', false, 1),
  c('one swap', 'abc', 'acb', false, 1),
  c('reversed', 'abc', 'cba', false, 2),
  c('OSA: no substring edited twice', 'ca', 'abc', false, 3),
  c('zero-width space removed', 'receive', 're\u200bceive', true, 0, { forgiven: ['zero-width'] }),
  c('full-width digits', '1, 2, 3', '１, ２, ３', true, 0),
  c('full-width & is not mapped (letters and digits only)', 'A&B', 'A＆B', false, 1),
  c('circled one is not 1', '1', '①', false, 1),
  c('ligature ﬁ is not fi', 'fi', 'ﬁ', false, 2),
  c('extra full stop', 'tea', 'tea.', true, 0),
  c('abbreviation full stop', 'U.S.A.', 'U.S.A', true, 0),
  c('family emoji is one grapheme', '👩‍👩‍👧', '👩', false, 1),
  c('flag', '🇭🇰', '🇭🇰', true, 0),
  c('different flag is one substitution', '🇭🇰 flag', '🇬🇧 flag', false, 1),
  c('Hebrew (RTL)', 'שלום', 'שלום', true, 0),
  c('Hebrew missing letter', 'שלום', 'שלם', false, 1),
  c('curly double quotes', '"quoted"', '“quoted”', true, 0),
  c('space for hyphen', 'x-ray', 'x ray', false, 1),
  // Chinese
  c('羣 and 群 are different characters', '羣', '群', false, 1),
  c('Chinese exact', '默書', '默書', true, 0),
  c('Simplified is not converted', '默書', '默书', false, 1),
  c('half-width full stop equals 。', '我愛你。', '我愛你.', true, 0, { forgiven: ['cjk-punct'] }),
  c('Chinese final punctuation is required', '我愛你。', '我愛你', false, 1),
  c('half-width comma equals ，', '你好，世界', '你好,世界', true, 0),
  c('stray spaces in Chinese count', '你好，世界', '你好 ， 世界', false, 2),
  c('CJK extension B', '𠮷', '𠮷', true, 0),
  c('𠮷 is not 吉', '𠮷野家', '吉野家', false, 1),
  c('half-width brackets in Chinese', '（一）', '(一)', true, 0),
  c('half-width question mark in Chinese', '你好嗎？', '你好嗎?', true, 0),
  c('one wrong character in a phrase', '默書 雲雀 羣', '默書 雲雀 群', false, 1),
  c('full-width letters in Chinese', 'ＡＢＣ書', 'ABC書', true, 0),
  // Options and accepted answers
  c('case-sensitive mode', 'London', 'london', false, 1, { off: ['case'] }),
  c('final punctuation required mode', 'The end.', 'The end', false, 1, { off: ['final-punct'] }),
  c('zero-width kept when the rule is off', 'ab', 'a\u200bb', false, 1, { off: ['zero-width'] }),
  c('case-sensitive mode still joins decomposed é', 'Café', 'Cafe\u0301', true, 0, {
    off: ['case'],
  }),
  c(
    'Chinese keeps final ASCII punctuation even with cjk-punct off',
    '我愛你!',
    '我愛你',
    false,
    1,
    {
      off: ['cjk-punct'],
    },
  ),
  c('accepted alternative', 'colour', 'color', true, 0, { accept: ['color'] }),
  c('closest target is reported', 'colour', 'colr', false, 1, { accept: ['color'] }),
  c('accepted 群 when the parent allows it', '羣', '群', true, 0, { accept: ['群'] }),
];
