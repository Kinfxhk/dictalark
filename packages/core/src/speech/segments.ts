// SPDX-License-Identifier: AGPL-3.0-or-later
// Passage mode: split a passage into short parts at punctuation so each part can be read
// (and repeated) on its own. Nothing is lost: joining the parts gives back the passage
// apart from the spaces between parts. Marks inside numbers (3.14, 1,000, 10:30) and
// English abbreviations (U.S.A.) do not split.

/** Marks that end a part. Closing quotes and brackets right after them stay attached. */
const BREAK = new Set([
  '，',
  '。',
  '？',
  '！',
  '；',
  '：',
  '、',
  '…',
  ',',
  '.',
  '?',
  '!',
  ';',
  ':',
]);
const TRAILING = new Set([
  '」',
  '』',
  '”',
  '’',
  '）',
  ')',
  '》',
  '〉',
  '"',
  "'",
  '…',
  '.',
  '!',
  '?',
  '。',
  '！',
  '？',
]);

export function splitPassage(text: string): string[] {
  const chars = [...text];
  const parts: string[] = [];
  let cur = '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    cur += ch;
    if (!BREAK.has(ch)) continue;
    const prev = chars[i - 1] ?? '';
    const next = chars[i + 1] ?? '';
    if ('.,:'.includes(ch) && /\d/.test(prev) && /\d/.test(next)) continue;
    if (ch === '.' && /[A-Za-z]/.test(prev) && /[A-Za-z]/.test(next)) continue;
    // Keep closing quotes / brackets and runs of marks (?!, ……, ...) with this part.
    while (i + 1 < chars.length && TRAILING.has(chars[i + 1]!)) cur += chars[++i]!;
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
