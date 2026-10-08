// SPDX-License-Identifier: AGPL-3.0-or-later
// Strict validation of untrusted data (imported files, IndexedDB contents). Every value
// is copied field by field into a fresh object, so unknown keys never travel further.

import { DictalarkError } from './errors';
import { LIMITS } from './limits';
import {
  MODES,
  RESULTS,
  SUBJECTS,
  type Attempt,
  type AttemptEntry,
  type Item,
  type SrsCard,
  type WordList,
} from './types';

type Obj = Record<string, unknown>;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const codePoints = (s: string) => [...s].length;

function bad(path: string, expected: string): never {
  throw new DictalarkError('bad-shape', { path, expected });
}

function obj(v: unknown, path: string): Obj {
  if (!isObj(v)) bad(path, 'object');
  return v;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) bad(path, 'array');
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string') bad(path, 'string');
  return v;
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], path: string): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v))
    throw new DictalarkError('bad-enum', { path, allowed: allowed.join('|') });
  return v as T;
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export function validateId(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ID_RE.test(s)) throw new DictalarkError('bad-id', { path });
  return s;
}

/** C0/C1 controls (tab included) and lone surrogates are never valid in text. */
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const LONE_SURROGATE_RE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** Clean and check a piece of user text (item, answer, note, name). */
export function validateText(
  v: unknown,
  path: string,
  { max = LIMITS.itemChars as number, allowEmpty = false } = {},
): string {
  const s = str(v, path).normalize('NFC').trim();
  if (!allowEmpty && s.length === 0) throw new DictalarkError('text-empty', { path });
  if (CONTROL_RE.test(s) || LONE_SURROGATE_RE.test(s))
    throw new DictalarkError('text-control-char', { path });
  if (codePoints(s) > max) throw new DictalarkError('text-too-long', { path, max });
  return s;
}

/** BCP-47 language tag, canonicalised (e.g. `en-gb` → `en-GB`). */
export function validateLang(v: unknown, path: string): string {
  const s = str(v, path);
  if (s.length > 35 || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(s))
    throw new DictalarkError('bad-lang', { path });
  try {
    const [canon] = Intl.getCanonicalLocales(s);
    if (!canon) throw new Error('empty');
    return canon;
  } catch {
    throw new DictalarkError('bad-lang', { path });
  }
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar day `YYYY-MM-DD` (2000–2999). */
export function validateDay(v: unknown, path: string): string {
  const s = str(v, path);
  const m = DAY_RE.exec(s);
  if (!m) throw new DictalarkError('bad-date', { path });
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (y < 2000 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > dim)
    throw new DictalarkError('bad-date', { path });
  return s;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
export function validateTimestamp(v: unknown, path: string): string {
  const s = str(v, path);
  if (!ISO_RE.test(s)) throw new DictalarkError('bad-date', { path });
  validateDay(s.slice(0, 10), path);
  const [h, mi, se] = [Number(s.slice(11, 13)), Number(s.slice(14, 16)), Number(s.slice(17, 19))];
  if (h > 23 || mi > 59 || se > 59) throw new DictalarkError('bad-date', { path });
  return s;
}

export function validateItem(v: unknown, path: string): Item {
  const o = obj(v, path);
  const accept = o.accept === undefined ? [] : arr(o.accept, `${path}.accept`);
  if (accept.length > LIMITS.acceptPerItem)
    throw new DictalarkError('too-many-items', {
      path: `${path}.accept`,
      max: LIMITS.acceptPerItem,
    });
  const item: Item = {
    id: validateId(o.id, `${path}.id`),
    text: validateText(o.text, `${path}.text`),
    accept: accept.map((a, i) => {
      const t = validateText(a, `${path}.accept[${i}]`);
      // "|" separates alternatives in CSV files, so it cannot be part of one.
      if (t.includes('|')) bad(`${path}.accept[${i}]`, 'an answer without "|"');
      return t;
    }),
    note: validateText(o.note ?? '', `${path}.note`, { allowEmpty: true }),
  };
  if (o.lang !== undefined && o.lang !== '') item.lang = validateLang(o.lang, `${path}.lang`);
  if (o.say !== undefined && o.say !== '') {
    const say = validateText(o.say, `${path}.say`, { allowEmpty: true });
    if (say !== '' && say !== item.text) item.say = say;
  }
  return item;
}

export function validateList(v: unknown, path = 'list'): WordList {
  const o = obj(v, path);
  const items = arr(o.items, `${path}.items`);
  if (items.length > LIMITS.itemsPerList)
    throw new DictalarkError('too-many-items', { path: `${path}.items`, max: LIMITS.itemsPerList });
  const list: WordList = {
    id: validateId(o.id, `${path}.id`),
    name: validateText(o.name, `${path}.name`, { max: LIMITS.nameChars }),
    subject: oneOf(o.subject, SUBJECTS, `${path}.subject`),
    lang: validateLang(o.lang, `${path}.lang`),
    items: items.map((it, i) => validateItem(it, `${path}.items[${i}]`)),
    createdAt: validateTimestamp(o.createdAt, `${path}.createdAt`),
    updatedAt: validateTimestamp(o.updatedAt, `${path}.updatedAt`),
  };
  assertUniqueIds(
    list.items.map((i) => i.id),
    `${path}.items`,
  );
  return list;
}

export function validateAttempt(v: unknown, path = 'attempt'): Attempt {
  const o = obj(v, path);
  const entries = arr(o.entries, `${path}.entries`);
  if (entries.length > LIMITS.itemsPerList)
    throw new DictalarkError('too-many-items', {
      path: `${path}.entries`,
      max: LIMITS.itemsPerList,
    });
  return {
    id: validateId(o.id, `${path}.id`),
    listId: validateId(o.listId, `${path}.listId`),
    day: validateDay(o.day, `${path}.day`),
    mode: oneOf(o.mode, MODES, `${path}.mode`),
    entries: entries.map((e, i): AttemptEntry => {
      const p = `${path}.entries[${i}]`;
      const eo = obj(e, p);
      return {
        itemId: validateId(eo.itemId, `${p}.itemId`),
        result: oneOf(eo.result, RESULTS, `${p}.result`),
        answer: validateText(eo.answer ?? '', `${p}.answer`, { allowEmpty: true, max: 400 }),
      };
    }),
  };
}

const SRS_KEY_RE = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
export function validateSrs(v: unknown, path = 'srs'): Record<string, SrsCard> {
  const o = obj(v, path);
  const out: Record<string, SrsCard> = Object.create(null) as Record<string, SrsCard>;
  for (const [k, card] of Object.entries(o)) {
    if (!SRS_KEY_RE.test(k)) throw new DictalarkError('bad-id', { path: `${path}.${k}` });
    const c = obj(card, `${path}.${k}`);
    const box = c.box;
    if (typeof box !== 'number' || !Number.isInteger(box) || box < 1 || box > 5)
      throw new DictalarkError('bad-enum', { path: `${path}.${k}.box`, allowed: '1|2|3|4|5' });
    out[k] = { box: box as SrsCard['box'], due: validateDay(c.due, `${path}.${k}.due`) };
  }
  return out;
}

export function assertUniqueIds(ids: string[], path: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new DictalarkError('duplicate-id', { path, id });
    seen.add(id);
  }
}

export { FORBIDDEN_KEYS, isObj };
