// SPDX-License-Identifier: AGPL-3.0-or-later
// Shared application state: the library, settings and the IndexedDB store.

import {
  DEFAULT_INTERVALS,
  DEFAULT_PLAYER,
  DictalarkError,
  errorMessage,
  isDictalarkError,
  LIMITS,
  localDay,
  nextCard,
  type Attempt,
  type ItemResult,
  type Library,
  type Mode,
  type PlayerConfig,
  type WordList,
} from '@dictalark/core';
import { byId } from './dom';
import type { Store } from './db';
import { EMPTY_BACKUP, noteChange, type BackupState, type PersistStatus } from './storage-guard';
import { getLocale, t, type Locale } from './strings';

export interface Settings {
  locale: Locale;
  theme: 'light' | 'dark';
  large: boolean;
  allowRemoteVoices: boolean;
  rate: number;
  player: PlayerConfig;
  hideText: boolean;
  readPunctuation: boolean;
  mode: Mode;
  shuffle: boolean;
  /** Passage mode: read each sentence part separately. */
  passage: boolean;
  /** Custom spoken names for punctuation, "mark = name" per line. */
  punctNames: string;
  /** Voice names chosen on the voices page (at most one per voice language). */
  preferredVoices: string[];
  backup: BackupState;
}

export const DEFAULT_SETTINGS: Settings = {
  locale: 'zh-HK',
  theme: 'light',
  large: false,
  allowRemoteVoices: false,
  rate: 0.9,
  player: { ...DEFAULT_PLAYER },
  hideText: true,
  readPunctuation: false,
  mode: 'paper',
  shuffle: false,
  passage: false,
  punctNames: '',
  preferredVoices: [],
  backup: { ...EMPTY_BACKUP },
};

export const app = {
  store: undefined as unknown as Store,
  lib: { lists: [], attempts: [], srs: {} } as Library,
  settings: { ...DEFAULT_SETTINGS } as Settings,
  /** Keys `${listId}/${itemId}` that have a recording. */
  recordings: new Set<string>(),
  persist: 'unsupported' as PersistStatus,
};

export const recKey = (listId: string, itemId: string): string => `${listId}/${itemId}`;

export function today(): string {
  // The UI is the only place that reads the clock; the core receives the day.
  return localDay(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
}

export const nowIso = (): string => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

export function findList(id: string): WordList | undefined {
  return app.lib.lists.find((l) => l.id === id);
}

export function showBanner(text: string, kind: 'info' | 'error' = 'info'): void {
  const b = byId('banner');
  b.textContent = text;
  b.className = `banner ${kind === 'error' ? 'error' : ''}`;
}

export function describeError(e: unknown): string {
  if (isDictalarkError(e)) return errorMessage(e, getLocale());
  return t('error.unexpected', { msg: String((e as Error)?.message ?? e) });
}

export async function saveLibrary(): Promise<boolean> {
  try {
    await app.store.saveLibrary(app.lib);
    app.settings.backup = noteChange(app.settings.backup, nowIso());
    await app.store.saveSettings(app.settings).catch(() => {});
    document.dispatchEvent(new Event('dictalark:saved'));
    return true;
  } catch (e) {
    showBanner(describeError(e), 'error');
    return false;
  }
}

export async function saveSettings(): Promise<void> {
  try {
    await app.store.saveSettings(app.settings);
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
}

/** Record a finished practice: attempts per list, review schedule per item. */
export async function recordResults(
  mode: Mode,
  entries: { listId: string; itemId: string; result: ItemResult; answer: string }[],
  newId: () => string,
): Promise<boolean> {
  const day = today();
  const byList = new Map<string, Attempt>();
  for (const e of entries) {
    let a = byList.get(e.listId);
    if (!a) {
      a = { id: newId(), listId: e.listId, day, mode, entries: [] };
      byList.set(e.listId, a);
    }
    a.entries.push({ itemId: e.itemId, result: e.result, answer: e.answer.slice(0, 400) });
    const key = recKey(e.listId, e.itemId);
    app.lib.srs[key] = nextCard(app.lib.srs[key], e.result, day, DEFAULT_INTERVALS);
  }
  for (const a of byList.values()) {
    app.lib.attempts.push(a);
    const mine = app.lib.attempts.filter((x) => x.listId === a.listId);
    if (mine.length > LIMITS.attemptsPerList) {
      const drop = new Set(mine.slice(0, mine.length - LIMITS.attemptsPerList).map((x) => x.id));
      app.lib.attempts = app.lib.attempts.filter((x) => !drop.has(x.id));
    }
  }
  return saveLibrary();
}

/** Remove a list with its history, schedule and recordings. */
export async function deleteList(id: string): Promise<void> {
  app.lib.lists = app.lib.lists.filter((l) => l.id !== id);
  app.lib.attempts = app.lib.attempts.filter((a) => a.listId !== id);
  for (const k of Object.keys(app.lib.srs)) if (k.startsWith(`${id}/`)) delete app.lib.srs[k];
  await saveLibrary();
  try {
    await app.store.deleteRecordingsOf(id);
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
  for (const k of [...app.recordings]) if (k.startsWith(`${id}/`)) app.recordings.delete(k);
}

export function assertListRoom(): void {
  if (app.lib.lists.length >= LIMITS.lists)
    throw new DictalarkError('too-many-lists', { max: LIMITS.lists });
}
