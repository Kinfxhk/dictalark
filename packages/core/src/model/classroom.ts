// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Class lists by file only (no accounts, no server):
//   • a teacher saves a **class pack** (chosen lists + a title and note) and sends the file
//     the way the school already does (email, school platform, USB stick);
//   • a pupil opens the pack: new lists are added, lists from an earlier pack (same id) are
//     updated, with a preview first;
//   • a pupil saves a **results file** for some lists (counts per practice and how often
//     each word was missed; never the typed answers);
//   • the teacher opens many results files and gets a summary on this device.
// Results files are made on the pupil's device and can be edited, so they are for practice
// feedback, not for marks; the UI says so.

import { DictalarkError } from './errors';
import { safeJsonParse } from './json';
import { LIMITS } from './limits';
import type { Library, Mode, WordList } from './types';
import { MODES } from './types';
import {
  assertUniqueIds,
  isObj,
  validateDay,
  validateId,
  validateList,
  validateText,
  validateTimestamp,
} from './validate';

export const PACK_FORMAT = 'dictalark-class-pack';
export const RESULTS_FORMAT = 'dictalark-class-results';
export const CLASS_SCHEMA = 1;
/** Results files one teacher may open together. */
export const MAX_RESULTS_FILES = 200;
/** Characters of a pack note. */
export const PACK_NOTE_CHARS = 500;

export interface ClassPack {
  format: typeof PACK_FORMAT;
  schema: number;
  title: string;
  note: string;
  madeAt: string;
  lists: WordList[];
}

export interface ResultsAttempt {
  day: string;
  mode: Mode;
  right: number;
  wrong: number;
  blank: number;
}

export interface ResultsList {
  listId: string;
  name: string;
  items: { id: string; text: string }[];
  attempts: ResultsAttempt[];
  /** Times each item was wrong or left blank, over all attempts (items never missed omitted). */
  missed: { itemId: string; times: number }[];
}

export interface ClassResults {
  format: typeof RESULTS_FORMAT;
  schema: number;
  pupil: string;
  madeAt: string;
  lists: ResultsList[];
}

const shape = (path: string, expected: string): never => {
  throw new DictalarkError('bad-shape', { path, expected });
};
const arrayOf = (v: unknown, path: string, max: number): unknown[] => {
  if (!Array.isArray(v)) shape(path, 'array');
  const a = v as unknown[];
  if (a.length > max) throw new DictalarkError('too-many-items', { path, max });
  return a;
};
const count = (v: unknown, path: string, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max)
    shape(path, `a whole number 0–${max}`);
  return v as number;
};
const header = (raw: unknown, format: string): Record<string, unknown> => {
  if (!isObj(raw) || raw.format !== format) throw new DictalarkError('unknown-format');
  if (raw.schema === undefined) throw new DictalarkError('missing-schema');
  if (typeof raw.schema !== 'number' || !Number.isInteger(raw.schema) || raw.schema < 1)
    shape('schema', 'a whole number');
  if ((raw.schema as number) > CLASS_SCHEMA)
    throw new DictalarkError('future-schema', {
      found: raw.schema as number,
      supported: CLASS_SCHEMA,
    });
  return raw;
};

// ------------------------------------------------------------------ class pack

export function serializePack(
  lists: readonly WordList[],
  meta: { title: string; note: string },
  madeAt: string,
): string {
  if (lists.length === 0) shape('lists', 'at least one list');
  const pack: ClassPack = {
    format: PACK_FORMAT,
    schema: CLASS_SCHEMA,
    title: validateText(meta.title, 'title', { max: LIMITS.nameChars }),
    note: validateText(meta.note, 'note', { max: PACK_NOTE_CHARS, allowEmpty: true }),
    madeAt: validateTimestamp(madeAt, 'madeAt'),
    lists: lists.map((l) => ({
      ...l,
      items: l.items.map((it) => ({ ...it, accept: [...it.accept] })),
    })),
  };
  return JSON.stringify(pack, null, 2) + '\n';
}

export function parsePack(text: string): ClassPack {
  const raw = header(safeJsonParse(text), PACK_FORMAT);
  const lists = arrayOf(raw.lists, 'lists', LIMITS.lists).map((l, i) =>
    validateList(l, `lists[${i}]`),
  );
  if (lists.length === 0) shape('lists', 'at least one list');
  assertUniqueIds(
    lists.map((l) => l.id),
    'lists',
  );
  return {
    format: PACK_FORMAT,
    schema: CLASS_SCHEMA,
    title: validateText(raw.title, 'title', { max: LIMITS.nameChars }),
    note: validateText(raw.note ?? '', 'note', { max: PACK_NOTE_CHARS, allowEmpty: true }),
    madeAt: validateTimestamp(raw.madeAt, 'madeAt'),
    lists,
  };
}

const content = (l: WordList) =>
  JSON.stringify([
    l.name,
    l.subject,
    l.lang,
    l.items.map((i) => [i.id, i.text, i.lang ?? null, i.accept, i.note, i.say ?? null]),
  ]);

export interface PackPlan {
  added: WordList[];
  updated: WordList[];
  unchanged: WordList[];
}

/** What opening the pack would do, without changing anything. */
export function planPack(lib: Library, pack: ClassPack): PackPlan {
  const plan: PackPlan = { added: [], updated: [], unchanged: [] };
  for (const l of pack.lists) {
    const mine = lib.lists.find((x) => x.id === l.id);
    if (!mine) plan.added.push(l);
    else if (content(mine) === content(l)) plan.unchanged.push(l);
    else plan.updated.push(l);
  }
  if (lib.lists.length + plan.added.length > LIMITS.lists)
    throw new DictalarkError('too-many-lists', { max: LIMITS.lists });
  return plan;
}

/**
 * Open a pack: add new lists, update lists that came from an earlier pack (same id).
 * Practice history is kept; review cards of words removed from a list are dropped.
 */
export function applyPack(lib: Library, pack: ClassPack, now: string): Library & PackPlan {
  const plan = planPack(lib, pack);
  const updated = new Map(plan.updated.map((l) => [l.id, l]));
  const copy = (l: WordList): WordList => ({
    ...l,
    items: l.items.map((it) => ({ ...it, accept: [...it.accept] })),
  });
  const lists = lib.lists.map((l) => {
    const u = updated.get(l.id);
    return u ? { ...copy(u), createdAt: l.createdAt, updatedAt: now } : l;
  });
  for (const l of plan.added) lists.push({ ...copy(l), createdAt: now, updatedAt: now });
  const srs = { ...lib.srs };
  for (const u of plan.updated) {
    const keep = new Set(u.items.map((i) => `${u.id}/${i.id}`));
    for (const k of Object.keys(srs)) if (k.startsWith(`${u.id}/`) && !keep.has(k)) delete srs[k];
  }
  return { lists, attempts: lib.attempts, srs, ...plan };
}

// ------------------------------------------------------------------ results files

/** Build a pupil's results for some lists (counts only; typed answers are never included). */
export function makeResults(
  lib: Library,
  listIds: readonly string[],
  pupil: string,
  madeAt: string,
): ClassResults {
  const lists = listIds.map((id): ResultsList => {
    const l = lib.lists.find((x) => x.id === id);
    if (!l) throw new DictalarkError('bad-id', { path: 'lists' });
    const itemIds = new Set(l.items.map((i) => i.id));
    const missed = new Map<string, number>();
    const attempts = lib.attempts
      .filter((a) => a.listId === id && a.entries.length > 0)
      .map((a): ResultsAttempt => {
        const n = { right: 0, wrong: 0, blank: 0 };
        for (const e of a.entries) {
          n[e.result]++;
          if (e.result !== 'right' && itemIds.has(e.itemId))
            missed.set(e.itemId, (missed.get(e.itemId) ?? 0) + 1);
        }
        return { day: a.day, mode: a.mode, ...n };
      });
    return {
      listId: l.id,
      name: l.name,
      items: l.items.map((i) => ({ id: i.id, text: i.text })),
      attempts,
      missed: l.items
        .filter((i) => missed.has(i.id))
        .map((i) => ({ itemId: i.id, times: missed.get(i.id)! })),
    };
  });
  return {
    format: RESULTS_FORMAT,
    schema: CLASS_SCHEMA,
    pupil: validateText(pupil, 'pupil', { max: LIMITS.nameChars }),
    madeAt: validateTimestamp(madeAt, 'madeAt'),
    lists,
  };
}

export function serializeResults(r: ClassResults): string {
  return JSON.stringify(r, null, 2) + '\n';
}

export function parseResults(text: string): ClassResults {
  const raw = header(safeJsonParse(text), RESULTS_FORMAT);
  const lists = arrayOf(raw.lists, 'lists', LIMITS.lists).map((v, i): ResultsList => {
    const p = `lists[${i}]`;
    if (!isObj(v)) return shape(p, 'object');
    const items = arrayOf(v.items, `${p}.items`, LIMITS.itemsPerList).map((it, j) => {
      if (!isObj(it)) return shape(`${p}.items[${j}]`, 'object');
      return {
        id: validateId(it.id, `${p}.items[${j}].id`),
        text: validateText(it.text, `${p}.items[${j}].text`),
      };
    });
    assertUniqueIds(
      items.map((it) => it.id),
      `${p}.items`,
    );
    const attempts = arrayOf(v.attempts, `${p}.attempts`, LIMITS.attemptsPerList).map(
      (a, j): ResultsAttempt => {
        const q = `${p}.attempts[${j}]`;
        if (!isObj(a)) return shape(q, 'object');
        if (typeof a.mode !== 'string' || !(MODES as readonly string[]).includes(a.mode))
          throw new DictalarkError('bad-enum', { path: `${q}.mode`, allowed: MODES.join('|') });
        const n = LIMITS.itemsPerList;
        const right = count(a.right, `${q}.right`, n);
        const wrong = count(a.wrong, `${q}.wrong`, n);
        const blank = count(a.blank, `${q}.blank`, n);
        const total = right + wrong + blank;
        if (total < 1 || total > n) shape(q, `between 1 and ${n} answers`);
        return { day: validateDay(a.day, `${q}.day`), mode: a.mode as Mode, right, wrong, blank };
      },
    );
    const ids = new Set(items.map((it) => it.id));
    const missed = arrayOf(v.missed, `${p}.missed`, LIMITS.itemsPerList).map((m, j) => {
      const q = `${p}.missed[${j}]`;
      if (!isObj(m)) return shape(q, 'object');
      const itemId = validateId(m.itemId, `${q}.itemId`);
      if (!ids.has(itemId)) shape(`${q}.itemId`, 'an item of this list');
      return { itemId, times: count(m.times, `${q}.times`, attempts.length) };
    });
    assertUniqueIds(
      missed.map((m) => m.itemId),
      `${p}.missed`,
    );
    return {
      listId: validateId(v.listId, `${p}.listId`),
      name: validateText(v.name, `${p}.name`, { max: LIMITS.nameChars }),
      items,
      attempts,
      missed,
    };
  });
  assertUniqueIds(
    lists.map((l) => l.listId),
    'lists',
  );
  return {
    format: RESULTS_FORMAT,
    schema: CLASS_SCHEMA,
    pupil: validateText(raw.pupil, 'pupil', { max: LIMITS.nameChars }),
    madeAt: validateTimestamp(raw.madeAt, 'madeAt'),
    lists,
  };
}

// ------------------------------------------------------------------ teacher's summary

export interface PupilRow {
  pupil: string;
  tries: number;
  /** Highest share right (ties: the earliest such attempt in the file). */
  best: { right: number; total: number } | null;
  /** The attempt on the latest day (ties: the last one in the file). */
  last: { day: string; right: number; total: number } | null;
}

export interface ListSummary {
  listId: string;
  name: string;
  rows: PupilRow[];
  /** Pupils with at least one try. */
  tried: number;
  /** Pupils whose last try had every answer right. */
  allRight: number;
  /** Words missed by most pupils first, then most times, then by text. */
  missed: { text: string; pupils: number; times: number }[];
}

export interface ClassSummary {
  pupils: string[];
  /** Files left out because a newer file of the same pupil was opened. */
  replaced: number;
  lists: ListSummary[];
}

const pupilKey = (s: string) => s.normalize('NFC').trim().toLowerCase();

/** Summarise many results files. A pupil's newest file wins (ties: the later one opened). */
export function summariseResults(files: readonly ClassResults[]): ClassSummary {
  if (files.length > MAX_RESULTS_FILES)
    throw new DictalarkError('too-many-items', { path: 'files', max: MAX_RESULTS_FILES });
  const latest = new Map<string, ClassResults>();
  for (const f of files) {
    const k = pupilKey(f.pupil);
    const prev = latest.get(k);
    if (!prev || f.madeAt >= prev.madeAt) latest.set(k, f);
  }
  const chosen = [...latest.values()].sort((a, b) =>
    pupilKey(a.pupil) < pupilKey(b.pupil) ? -1 : pupilKey(a.pupil) > pupilKey(b.pupil) ? 1 : 0,
  );
  const order: string[] = [];
  const names = new Map<string, string>();
  for (const f of chosen)
    for (const l of f.lists)
      if (!names.has(l.listId)) {
        names.set(l.listId, l.name);
        order.push(l.listId);
      }
  const lists = order.map((listId): ListSummary => {
    const rows: PupilRow[] = [];
    const missed = new Map<string, { text: string; pupils: number; times: number }>();
    for (const f of chosen) {
      const l = f.lists.find((x) => x.listId === listId);
      let best: PupilRow['best'] = null;
      let last: PupilRow['last'] = null;
      for (const a of l?.attempts ?? []) {
        const total = a.right + a.wrong + a.blank;
        if (!best || a.right * best.total > best.right * total) best = { right: a.right, total };
        if (!last || a.day >= last.day) last = { day: a.day, right: a.right, total };
      }
      rows.push({ pupil: f.pupil, tries: l?.attempts.length ?? 0, best, last });
      for (const m of l?.missed ?? []) {
        if (m.times === 0) continue;
        const text = l!.items.find((i) => i.id === m.itemId)!.text;
        const w = missed.get(text) ?? { text, pupils: 0, times: 0 };
        w.pupils++;
        w.times += m.times;
        missed.set(text, w);
      }
    }
    return {
      listId,
      name: names.get(listId)!,
      rows,
      tried: rows.filter((r) => r.tries > 0).length,
      allRight: rows.filter((r) => r.last && r.last.right === r.last.total).length,
      missed: [...missed.values()].sort(
        (a, b) =>
          b.pupils - a.pupils ||
          b.times - a.times ||
          (a.text < b.text ? -1 : a.text > b.text ? 1 : 0),
      ),
    };
  });
  return { pupils: chosen.map((f) => f.pupil), replaced: files.length - chosen.length, lists };
}

/** One row per pupil and list: pupil, list, tries, best, last day, last score. */
export function summaryRows(s: ClassSummary): string[][] {
  const out = [['pupil', 'list', 'tries', 'best', 'last day', 'last']];
  for (const l of s.lists)
    for (const r of l.rows)
      out.push([
        r.pupil,
        l.name,
        String(r.tries),
        r.best ? `${r.best.right}/${r.best.total}` : '',
        r.last?.day ?? '',
        r.last ? `${r.last.right}/${r.last.total}` : '',
      ]);
  return out;
}
