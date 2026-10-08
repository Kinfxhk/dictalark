// SPDX-License-Identifier: AGPL-3.0-or-later
// RFC 4180 reader/writer for word lists (comma or tab separated). Handles a UTF-8 BOM,
// CRLF / LF / CR line endings (mixed too), quoted fields containing separators, quotes
// ("" escape) and line breaks, blank lines, header-only files and ragged rows. Exports
// neutralise spreadsheet formulas in a reversible way, so export → import is lossless.

import { DictalarkError } from '../model/errors';
import { LIMITS } from '../model/limits';
import { utf8Bytes } from '../model/json';

export type Delimiter = ',' | '\t';

/** Guess the separator from the first non-empty line outside quotes. */
export function detectDelimiter(text: string): Delimiter {
  let tabs = 0;
  let commas = 0;
  let inQuotes = false;
  for (const ch of text.replace(/^\ufeff/, '')) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (tabs + commas > 0) break;
    } else if (!inQuotes && ch === '\t') tabs++;
    else if (!inQuotes && ch === ',') commas++;
  }
  return tabs > commas ? '\t' : ',';
}

/** Parse into rows of raw cells. Lines that are completely empty are skipped. */
export function parseCsv(text: string, delimiter: Delimiter = detectDelimiter(text)): string[][] {
  if (utf8Bytes(text) > LIMITS.importBytes)
    throw new DictalarkError('too-large', { max: LIMITS.importBytes });
  const s = text.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  let quoted = false; // current cell started with a quote
  let rowHasContent = false;
  const endCell = () => {
    row.push(cell);
    if (cell !== '' || quoted) rowHasContent = true;
    cell = '';
    quoted = false;
  };
  const endRow = () => {
    endCell();
    if (rowHasContent) rows.push(row);
    row = [];
    rowHasContent = false;
  };
  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '"' && cell === '' && !quoted) {
      // quoted cell: read to the closing quote
      quoted = true;
      i++;
      let closed = false;
      while (i < s.length) {
        const c = s[i]!;
        if (c === '"') {
          if (s[i + 1] === '"') {
            cell += '"';
            i += 2;
            continue;
          }
          i++;
          closed = true;
          break;
        }
        cell += c;
        i++;
      }
      if (!closed) throw new DictalarkError('csv-unterminated-quote', { row: rows.length + 1 });
      // Anything between the closing quote and the next separator is kept as text
      // (lenient, like spreadsheets do).
      continue;
    }
    if (ch === delimiter) {
      endCell();
      i++;
    } else if (ch === '\r' || ch === '\n') {
      endRow();
      i += ch === '\r' && s[i + 1] === '\n' ? 2 : 1;
    } else {
      cell += ch;
      i++;
    }
  }
  if (cell !== '' || quoted || row.length > 0) endRow();
  return rows;
}

const NEEDS_QUOTES = /[",\t\r\n]|^[\s\ufeff]|\s$/;
/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** A leading apostrophe followed by one of these was added by us (or must be kept). */
const GUARDED = /^'[=+\-@\t\r']/;

/** Neutralise formulas: prefix `'` when a cell starts with = + - @ TAB CR (or looks guarded). */
export function guardFormula(v: string): string {
  return FORMULA_START.test(v) || GUARDED.test(v) ? `'${v}` : v;
}

/** Inverse of guardFormula (applied on import). */
export function unguardFormula(v: string): string {
  return GUARDED.test(v) ? v.slice(1) : v;
}

export function stringifyCsv(
  rows: readonly (readonly string[])[],
  delimiter: Delimiter = ',',
): string {
  return rows
    .map((r) =>
      r
        .map((raw) => {
          const v = guardFormula(raw);
          return NEEDS_QUOTES.test(v) || v.includes(delimiter) ? `"${v.replace(/"/g, '""')}"` : v;
        })
        .join(delimiter),
    )
    .map((line) => line + '\r\n')
    .join('');
}
