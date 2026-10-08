// SPDX-License-Identifier: AGPL-3.0-or-later
// "Read punctuation aloud" for teacher mode: each punctuation mark in a sentence is
// replaced by its spoken name, e.g. 「你好，世界。」 → 「你好 逗號 世界 句號」 and
// "Hello, world." → "Hello comma world full stop". Apostrophes and hyphens inside words
// (don't, well-known) are part of the word and are not read.

import { isCantoneseTag, normTag } from './voices';

type Names = Record<string, string>;

const ZH: Names = {
  '，': '逗號',
  ',': '逗號',
  '。': '句號',
  '.': '句號',
  '？': '問號',
  '?': '問號',
  '！': '感嘆號',
  '!': '感嘆號',
  '：': '冒號',
  ':': '冒號',
  '；': '分號',
  ';': '分號',
  '、': '頓號',
  '「': '開引號',
  '」': '關引號',
  '『': '開雙引號',
  '』': '關雙引號',
  '“': '開引號',
  '”': '關引號',
  '（': '開括號',
  '(': '開括號',
  '）': '關括號',
  ')': '關括號',
  '《': '開書名號',
  '》': '關書名號',
  '〈': '開篇名號',
  '〉': '關篇名號',
  '……': '省略號',
  '...': '省略號',
  '…': '省略號',
  '——': '破折號',
  '·': '間隔號',
  '‧': '間隔號',
};

const EN_GB: Names = {
  ',': 'comma',
  '.': 'full stop',
  '?': 'question mark',
  '!': 'exclamation mark',
  ':': 'colon',
  ';': 'semicolon',
  '“': 'open quote',
  '”': 'close quote',
  '(': 'open bracket',
  ')': 'close bracket',
  '...': 'ellipsis',
  '…': 'ellipsis',
  '—': 'dash',
  '–': 'dash',
};
const EN_US: Names = {
  ...EN_GB,
  '.': 'period',
  '!': 'exclamation point',
  '(': 'open parenthesis',
  ')': 'close parenthesis',
};

function namesFor(lang: string): Names | undefined {
  const t = normTag(lang);
  if (isCantoneseTag(t) || t.startsWith('zh') || t.startsWith('cmn')) return ZH;
  if (t === 'en-us' || t === 'en-ca' || t === 'en-ph') return EN_US;
  if (t === 'en' || t.startsWith('en-')) return EN_GB;
  return undefined;
}

/** Spoken form of `text`, or the text unchanged for languages without a table. */
export function speakPunctuation(text: string, lang: string): string {
  const names = namesFor(lang);
  if (!names) return text;
  const keys = Object.keys(names).sort((a, b) => b.length - a.length);
  const chinese = names === ZH;
  const out: string[] = [];
  let word = '';
  let quoteOpen = false;
  const flush = () => {
    if (word.trim()) out.push(word.trim());
    word = '';
  };
  for (let i = 0; i < text.length;) {
    const ch = text[i]!;
    // Straight double quotes alternate open / close.
    if (ch === '"') {
      flush();
      out.push(
        chinese ? (quoteOpen ? '關引號' : '開引號') : quoteOpen ? 'close quote' : 'open quote',
      );
      quoteOpen = !quoteOpen;
      i++;
      continue;
    }
    const key = keys.find((k) => text.startsWith(k, i));
    // "." "," ":" between digits (3.14, 1,000, 10:30) belong to the number; in English
    // "." between letters (U.S.A) and "-" "'" inside words belong to the word.
    const prev = text[i - 1] ?? '';
    const next = key ? (text[i + key.length] ?? '') : '';
    const inNumber = key !== undefined && /^[.,:]$/.test(key) && /\d/.test(prev) && /\d/.test(next);
    const abbreviation = !chinese && key === '.' && /[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next);
    if (key && !inNumber && !abbreviation) {
      flush();
      out.push(names[key]!);
      i += key.length;
      continue;
    }
    word += ch;
    i++;
  }
  flush();
  return out.join(' ');
}
