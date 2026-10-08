// SPDX-License-Identifier: AGPL-3.0-or-later
// Turn a parsed CSV/TSV table into list items (with a column mapping), and a list back
// into a table. Accepted alternative answers are separated by " | " in one cell.

import { DictalarkError } from '../model/errors';
import { LIMITS } from '../model/limits';
import type { Item, WordList } from '../model/types';
import { validateLang, validateText } from '../model/validate';
import { parseCsv, stringifyCsv, unguardFormula } from './csv';

export interface ColumnMap {
  text: number;
  accept?: number;
  note?: number;
  lang?: number;
  /** Spoken text (what the voice says instead of the word). */
  say?: number;
}

export const EXPORT_HEADER = ['text', 'accept', 'note', 'lang', 'say'] as const;

const HEADER_NAMES: Record<keyof ColumnMap, RegExp> = {
  text: /^(text|word|words|term|item|詞語|詞|字詞|生字|句子|內容|文字)$/i,
  accept: /^(accept|accepted|also accept|alternatives?|可接受答案|其他答案|另一寫法)$/i,
  note: /^(note|notes|hint|meaning|備註|提示|解釋)$/i,
  lang: /^(lang|language|語言)$/i,
  say: /^(say|spoken|read as|讀法|讀出|讀出文字)$/i,
};

/** Guess whether row 0 is a header and which columns hold what. */
export function guessColumns(rows: readonly string[][]): { map: ColumnMap; hasHeader: boolean } {
  const first = rows[0] ?? [];
  const map: Partial<ColumnMap> = {};
  first.forEach((cell, idx) => {
    const c = cell.trim();
    for (const key of Object.keys(HEADER_NAMES) as (keyof ColumnMap)[])
      if (map[key] === undefined && HEADER_NAMES[key].test(c)) map[key] = idx;
  });
  if (map.text !== undefined) return { map: map as ColumnMap, hasHeader: true };
  return { map: { text: 0 }, hasHeader: false };
}

export interface TableImport {
  items: Omit<Item, 'id'>[];
  /** Rows that were skipped because the text cell was empty (1-based, as in the file). */
  skippedRows: number[];
}

export function itemsFromTable(
  rows: readonly string[][],
  map: ColumnMap,
  hasHeader: boolean,
): TableImport {
  const body = hasHeader ? rows.slice(1) : rows;
  if (body.length === 0) throw new DictalarkError(rows.length ? 'csv-empty' : 'csv-empty');
  const maxCol = Math.max(...body.map((r) => r.length));
  if (map.text < 0 || map.text >= maxCol) throw new DictalarkError('csv-no-text-column');
  const items: Omit<Item, 'id'>[] = [];
  const skippedRows: number[] = [];
  body.forEach((r, i) => {
    const line = i + 1 + (hasHeader ? 1 : 0);
    const cell = (idx: number | undefined) =>
      idx === undefined ? '' : unguardFormula(r[idx] ?? '');
    const raw = cell(map.text);
    if (raw.trim() === '') {
      skippedRows.push(line);
      return;
    }
    const path = `row ${line}`;
    const acceptCell = cell(map.accept);
    const item: Omit<Item, 'id'> = {
      text: validateText(raw, path),
      accept: acceptCell
        .split('|')
        .map((a) => a.trim())
        .filter(Boolean)
        .map((a) => validateText(a, `${path} accept`)),
      note: validateText(cell(map.note), `${path} note`, { allowEmpty: true }),
    };
    const lang = cell(map.lang).trim();
    if (lang) item.lang = validateLang(lang, `${path} lang`);
    const say = validateText(cell(map.say), `${path} say`, { allowEmpty: true });
    if (say && say !== item.text) item.say = say;
    items.push(item);
  });
  if (items.length > LIMITS.itemsPerList)
    throw new DictalarkError('too-many-items', { max: LIMITS.itemsPerList });
  if (items.length === 0) throw new DictalarkError('csv-empty');
  return { items, skippedRows };
}

/** Parse CSV/TSV text with automatic column guessing. */
export function importTable(text: string): TableImport & { map: ColumnMap; hasHeader: boolean } {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new DictalarkError('csv-empty');
  const { map, hasHeader } = guessColumns(rows);
  return { ...itemsFromTable(rows, map, hasHeader), map, hasHeader };
}

/** CSV export of one list (UTF-8 with BOM so spreadsheets detect the encoding). */
export function listToCsv(list: WordList): string {
  const rows = [
    [...EXPORT_HEADER],
    ...list.items.map((it) => [
      it.text,
      it.accept.join(' | '),
      it.note,
      it.lang ?? '',
      it.say ?? '',
    ]),
  ];
  return '\ufeff' + stringifyCsv(rows);
}
