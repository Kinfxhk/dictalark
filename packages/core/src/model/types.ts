// SPDX-License-Identifier: AGPL-3.0-or-later

export const SUBJECTS = ['chinese', 'english', 'mandarin', 'other'] as const;
export type Subject = (typeof SUBJECTS)[number];

export const MODES = ['paper', 'typing', 'cards'] as const;
export type Mode = (typeof MODES)[number];

/** Result of one item in one practice. `blank` = not answered. */
export const RESULTS = ['right', 'wrong', 'blank'] as const;
export type ItemResult = (typeof RESULTS)[number];

/** A local calendar day, `YYYY-MM-DD`. Never a timestamp. */
export type CalendarDay = string;

export interface Item {
  id: string;
  text: string;
  /** BCP-47 tag overriding the list's language, e.g. `en-US`. */
  lang?: string;
  /** Other answers that also count as right, e.g. `color` for `colour`. */
  accept: string[];
  note: string;
  /**
   * What the voice says instead of `text`, e.g. a homophone that makes a device voice pick
   * the right reading of a 多音字. Marking always uses `text`. Absent = read `text`.
   */
  say?: string;
}

export interface WordList {
  id: string;
  name: string;
  subject: Subject;
  /** Default BCP-47 language for reading aloud, e.g. `en-GB`, `yue-HK`, `cmn-Hans-CN`. */
  lang: string;
  items: Item[];
  /** ISO 8601 UTC timestamps (display only; never used for scheduling). */
  createdAt: string;
  updatedAt: string;
}

export interface AttemptEntry {
  itemId: string;
  result: ItemResult;
  /** What was typed (typing mode); empty otherwise. */
  answer: string;
}

export interface Attempt {
  id: string;
  listId: string;
  day: CalendarDay;
  mode: Mode;
  entries: AttemptEntry[];
}

/** Leitner state of one item (key: `${listId}/${itemId}`). */
export interface SrsCard {
  box: 1 | 2 | 3 | 4 | 5;
  due: CalendarDay;
}

export interface Library {
  lists: WordList[];
  attempts: Attempt[];
  srs: Record<string, SrsCard>;
}

/** One recording inside a full backup (schema 2+). `data` is base64 in the file. */
export interface BackupRecording {
  listId: string;
  itemId: string;
  mime: string;
  /** Length in milliseconds. */
  ms: number;
  data: Uint8Array;
}

/**
 * The JSON export / backup file. Schema 1 (v0.1) had no recordings; schema 2 may carry
 * them in `recordings` (base64), so one file restores everything.
 */
export interface ExportFile {
  format: 'dictalark';
  schema: number;
  exportedAt: string;
  lists: WordList[];
  attempts: Attempt[];
  srs: Record<string, SrsCard>;
  recordings?: { listId: string; itemId: string; mime: string; ms: number; data: string }[];
}
