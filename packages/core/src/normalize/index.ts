// SPDX-License-Identifier: AGPL-3.0-or-later
// Answer normalisation. Every rule has an id and can be switched off. Rules only remove
// differences that are about typing, never about spelling: Chinese is NOT converted
// between Traditional and Simplified and variant characters are NOT merged, so 「群」 is
// wrong for 「羣」 unless a parent adds it as an accepted answer.

export const RULE_IDS = [
  'nfc', // Unicode NFC (é typed as e + combining accent equals é)
  'zero-width', // remove U+200B, U+2060, U+FEFF (invisible; reported to the learner)
  'fullwidth-alnum', // ＡＢＣ１２３ → ABC123 (letters and digits only)
  'quotes', // ’ ‘ ʼ ′ → '   “ ” → "
  'dashes', // U+2010–U+2015, U+2212 → -
  'spaces', // NBSP and other spaces → space; trim; collapse runs
  'cjk-punct', // in Chinese answers, , . ? ! : ; ( ) equal ， 。 ？ ！ ： ； （ ）
  'final-punct', // in non-Chinese answers, a final . ! ? is optional
  'case', // letter case is ignored
] as const;
export type RuleId = (typeof RULE_IDS)[number];

export type RuleSwitches = Record<RuleId, boolean>;

export const DEFAULT_RULES: Readonly<RuleSwitches> = Object.freeze({
  nfc: true,
  'zero-width': true,
  'fullwidth-alnum': true,
  quotes: true,
  dashes: true,
  spaces: true,
  'cjk-punct': true,
  'final-punct': true,
  case: true,
});

const HAN = /\p{Script=Han}/u;
export const hasHan = (s: string): boolean => HAN.test(s);

const ZERO_WIDTH = /[\u200b\u2060\ufeff]/g;
const FULLWIDTH_ALNUM = /[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/g;
const SINGLE_QUOTES = /[\u2018\u2019\u02bc\u2032]/g;
const DOUBLE_QUOTES = /[\u201c\u201d]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
const SPACES = /[\s\u00a0\u2000-\u200a\u202f\u205f\u3000]+/gu;
const HALF_TO_FULL: Record<string, string> = {
  ',': '，',
  '.': '。',
  '?': '？',
  '!': '！',
  ':': '：',
  ';': '；',
  '(': '（',
  ')': '）',
};
const FINAL_PUNCT = /[.!?]+$/;

export interface Normalized {
  text: string;
  /** Rules that changed this text. */
  changed: RuleId[];
}

/**
 * Normalise one string. `chinese` decides between the cjk-punct and final-punct rules
 * and must be computed from the expected answer (so both sides use the same rules).
 */
export function normalize(input: string, rules: RuleSwitches, chinese: boolean): Normalized {
  const changed: RuleId[] = [];
  let s = input;
  const step = (id: RuleId, f: (x: string) => string) => {
    if (!rules[id]) return;
    const next = f(s);
    if (next !== s) changed.push(id);
    s = next;
  };
  step('nfc', (x) => x.normalize('NFC'));
  step('zero-width', (x) => x.replace(ZERO_WIDTH, ''));
  step('fullwidth-alnum', (x) =>
    x.replace(FULLWIDTH_ALNUM, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
  );
  step('quotes', (x) => x.replace(SINGLE_QUOTES, "'").replace(DOUBLE_QUOTES, '"'));
  step('dashes', (x) => x.replace(DASHES, '-'));
  step('spaces', (x) => x.replace(SPACES, ' ').trim());
  if (chinese) step('cjk-punct', (x) => x.replace(/[,.?!:;()]/g, (c) => HALF_TO_FULL[c] ?? c));
  else step('final-punct', (x) => x.replace(FINAL_PUNCT, '').trimEnd());
  return { text: s, changed };
}

/** Comparison key of one grapheme: lower case when the case rule is on. */
export function graphemeKey(g: string, rules: RuleSwitches): string {
  // toLowerCase (never toUpperCase): dotless ı stays ı, İ becomes i + U+0307 (≠ i),
  // and ß stays ß (toUpperCase would turn it into SS and accept "strasse").
  return rules.case ? g.toLowerCase().normalize('NFC') : g;
}

const SEGMENTER = new Intl.Segmenter('und', { granularity: 'grapheme' });
/** Split into user-perceived characters (emoji, flags, combining marks stay whole). */
export function graphemes(s: string): string[] {
  return Array.from(SEGMENTER.segment(s), (x) => x.segment);
}
