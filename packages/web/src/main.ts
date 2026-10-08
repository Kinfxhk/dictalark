// SPDX-License-Identifier: AGPL-3.0-or-later
// Entry point: settings, routing and the home and review screens.

import {
  decodeShare,
  decodeUtf8,
  DictalarkError,
  dueKeys,
  importTable,
  LIMITS,
  mergeLibrary,
  mergeLibraryWithIds,
  parseBackup,
  parseLibrary,
  serializeBackup,
  type BackupRecording,
  type WordList,
} from '@dictalark/core';
import {
  app,
  assertListRoom,
  DEFAULT_SETTINGS,
  describeError,
  nowIso,
  saveLibrary,
  saveSettings,
  showBanner,
  today,
  type Settings,
} from './app';
import { openStore } from './db';
import { byId, download, fileName, h, newId } from './dom';
import { DEFAULT_LANG, renderEditor } from './editor';
import { onVoicesChanged } from './env';
import { ensurePersisted, noteBackup, readBackupState, reminderDue, snooze } from './storage-guard';
import { renderVoices } from './voices-page';
import { renderPractice, reviewItems, stopPractice } from './practice';
import { SAMPLE_FILES } from './samples';
import { setLocale, t, type StringKey } from './strings';
import './styles.css';

const view = byId('view');

function applySettings(): void {
  const s = app.settings;
  setLocale(s.locale);
  document.documentElement.lang = s.locale;
  document.documentElement.dataset.theme = s.theme;
  document.documentElement.classList.toggle('large', s.large);
  byId<HTMLSelectElement>('set-lang').value = s.locale;
  byId<HTMLSelectElement>('set-theme').value = s.theme;
  byId<HTMLInputElement>('set-large').checked = s.large;
  byId<HTMLInputElement>('set-remote').checked = s.allowRemoteVoices;
  byId('remote-label').title = t('settings.remoteHelp');
  for (const el of document.querySelectorAll<HTMLElement>('[data-t]'))
    el.textContent = t(el.dataset.t as StringKey);
  updateNav();
}

function updateNav(): void {
  byId('nav-review').textContent = t('nav.review', { n: dueKeys(app.lib.srs, today()).length });
}

function bindSettings(): void {
  const on = (id: string, fn: (el: HTMLInputElement) => void) =>
    byId<HTMLInputElement>(id).addEventListener('change', async (e) => {
      fn(e.target as HTMLInputElement);
      applySettings();
      await saveSettings();
      route();
    });
  on('set-lang', (el) => (app.settings.locale = el.value === 'en' ? 'en' : 'zh-HK'));
  on('set-theme', (el) => (app.settings.theme = el.value === 'dark' ? 'dark' : 'light'));
  on('set-large', (el) => (app.settings.large = el.checked));
  on('set-remote', (el) => (app.settings.allowRemoteVoices = el.checked));
}

/** Merge stored settings over the defaults, keeping only known, well-typed values. */
function loadSettings(raw: unknown): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, player: { ...DEFAULT_SETTINGS.player } };
  if (typeof raw !== 'object' || raw === null) return s;
  const r = raw as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k === 'player' || k === 'backup' || k === 'preferredVoices') continue;
    if (typeof r[k] === typeof DEFAULT_SETTINGS[k])
      (s as unknown as Record<string, unknown>)[k] = r[k];
  }
  if (s.locale !== 'en' && s.locale !== 'zh-HK') s.locale = 'zh-HK';
  if (s.theme !== 'dark') s.theme = 'light';
  if (!['paper', 'typing', 'cards'].includes(s.mode)) s.mode = 'paper';
  if (!(s.rate >= 0.5 && s.rate <= 1.5)) s.rate = DEFAULT_SETTINGS.rate;
  s.backup = readBackupState(r.backup);
  s.preferredVoices = Array.isArray(r.preferredVoices)
    ? r.preferredVoices
        .filter((v): v is string => typeof v === 'string' && v.length <= 200)
        .slice(0, 40)
    : [];
  if (s.punctNames.length > 4000) s.punctNames = '';
  const p = r.player as Record<string, unknown> | undefined;
  if (p && typeof p === 'object')
    for (const k of Object.keys(s.player) as (keyof Settings['player'])[])
      if (Number.isInteger(p[k])) s.player[k] = p[k] as number;
  return s;
}

// ---------------------------------------------------------------- home

async function newList(): Promise<void> {
  try {
    assertListRoom();
  } catch (e) {
    showBanner(describeError(e), 'error');
    return;
  }
  const subject = app.settings.locale === 'en' ? 'english' : 'chinese';
  const list: WordList = {
    id: newId(),
    name: `${t('home.newName')} ${app.lib.lists.length + 1}`,
    subject,
    lang: DEFAULT_LANG[subject],
    items: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  app.lib.lists.push(list);
  if (await saveLibrary()) location.hash = `#/list/${list.id}`;
}

/** Ask the browser to keep our storage (once per page load, only when there is data). */
let persistAsked = false;
async function askPersist(force = false): Promise<void> {
  if (app.persist === 'persisted' || (persistAsked && !force)) return;
  if (!force && app.lib.lists.length === 0) return;
  persistAsked = true;
  app.persist = await ensurePersisted(navigator.storage);
  updatePersistStatus();
}

function updatePersistStatus(): void {
  const el = document.getElementById('persist-status');
  if (!el) return;
  el.dataset.status = app.persist;
  el.textContent = t(`persist.${app.persist}` as StringKey);
  const again = document.getElementById('persist-again');
  if (again) again.hidden = app.persist !== 'not-persisted';
}

/** Save a full backup file (lists, results, review schedule and recordings). */
async function backupNow(): Promise<void> {
  try {
    const recs: BackupRecording[] = (await app.store.allRecordings()).map(({ key, rec }) => {
      const [listId = '', itemId = ''] = key.split('/');
      return { listId, itemId, mime: rec.mime, ms: rec.ms, data: new Uint8Array(rec.data) };
    });
    download(
      fileName(`dictalark-backup-${today()}`, 'json'),
      serializeBackup(app.lib, recs, nowIso()),
      'application/json',
    );
    app.settings.backup = noteBackup(nowIso());
    await saveSettings();
    updateReminder();
    showBanner(t('backup.saved', { n: recs.length }));
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
}

/** The gentle "save a backup" reminder: home and list pages only, never during a dictation. */
function updateReminder(): void {
  const box = byId('reminder');
  const page = location.hash.match(/^#\/([a-z]*)/)?.[1] ?? '';
  const due =
    (page === '' || page === 'list') &&
    reminderDue(app.settings.backup, Date.now(), app.lib.lists.length > 0);
  box.hidden = !due;
  if (!due) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(
    h('span', {}, t('backup.reminder', { n: app.settings.backup.changes })),
    ' ',
    h(
      'button',
      { type: 'button', class: 'primary', id: 'reminder-backup', onclick: () => void backupNow() },
      t('backup.now'),
    ),
    ' ',
    h(
      'button',
      {
        type: 'button',
        id: 'reminder-later',
        onclick: async () => {
          app.settings.backup = snooze(app.settings.backup, nowIso());
          await saveSettings();
          updateReminder();
        },
      },
      t('backup.later'),
    ),
  );
}

async function importFile(file: File): Promise<void> {
  try {
    const trimmedName = file.name;
    const isJson = /\.json$/i.test(trimmedName);
    const cap = isJson ? LIMITS.backupBytes : LIMITS.importBytes;
    if (file.size > cap) throw new DictalarkError('too-large', { max: cap });
    const text = decodeUtf8(new Uint8Array(await file.arrayBuffer()), cap);
    const trimmed = text.replace(/^\ufeff/, '').trimStart();
    if (isJson || trimmed.startsWith('{')) {
      const incoming = parseBackup(text);
      const { lib: merged, listIds } = mergeLibraryWithIds(app.lib, incoming, newId);
      const before = app.lib;
      app.lib = merged;
      if (!(await saveLibrary())) {
        app.lib = before;
        return;
      }
      let restored = 0;
      let failed: unknown;
      for (const r of incoming.recordings) {
        const key = `${listIds.get(r.listId) ?? r.listId}/${r.itemId}`;
        try {
          const data = r.data.buffer.slice(
            r.data.byteOffset,
            r.data.byteOffset + r.data.byteLength,
          );
          await app.store.putRecording(key, {
            data: data as ArrayBuffer,
            mime: r.mime,
            bytes: r.data.byteLength,
            ms: r.ms,
          });
          app.recordings.add(key);
          restored++;
        } catch (e) {
          failed = e;
          break;
        }
      }
      showBanner(
        t('home.imported', { n: incoming.lists.length }) +
          (incoming.recordings.length ? ` ${t('backup.recRestored', { n: restored })}` : '') +
          (failed ? ` ${describeError(failed)}` : ''),
        failed ? 'error' : 'info',
      );
    } else {
      assertListRoom();
      const table = importTable(text);
      const name =
        file.name.replace(/\.[^.]*$/, '').slice(0, LIMITS.nameChars) || t('home.newName');
      const list: WordList = {
        id: newId(),
        name,
        subject: 'other',
        lang: 'en-GB',
        items: table.items.map((it) => ({ ...it, id: newId() })),
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      if (/\p{Script=Han}/u.test(list.items.map((i) => i.text).join(''))) {
        list.subject = 'chinese';
        list.lang = DEFAULT_LANG.chinese;
      } else list.subject = 'english';
      app.lib.lists.push(list);
      if (!(await saveLibrary())) {
        app.lib.lists.pop();
        return;
      }
      showBanner(
        t('home.importedCsv', { n: list.items.length, name }) +
          (table.skippedRows.length
            ? ` ${t('home.skipped', { rows: table.skippedRows.join(', ') })}`
            : ''),
      );
    }
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
  route();
}

async function addSamples(): Promise<void> {
  try {
    const names = new Set(app.lib.lists.map((l) => l.name));
    let lib = app.lib;
    let added = 0;
    for (const raw of SAMPLE_FILES) {
      const sample = parseLibrary(raw);
      const fresh = { ...sample, lists: sample.lists.filter((l) => !names.has(l.name)) };
      if (fresh.lists.length === 0) continue;
      const stamp = nowIso();
      fresh.lists = fresh.lists.map((l) => ({ ...l, createdAt: stamp, updatedAt: stamp }));
      lib = mergeLibrary(lib, fresh, newId);
      added += fresh.lists.length;
    }
    if (added === 0) {
      showBanner(t('home.samplesThere'));
      return;
    }
    const before = app.lib;
    app.lib = lib;
    if (await saveLibrary()) showBanner(t('home.samplesAdded', { n: added }));
    else app.lib = before;
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
  route();
}

function renderHome(): void {
  const day = today();
  const due = new Set(dueKeys(app.lib.srs, day));
  const fileInput = h('input', {
    type: 'file',
    id: 'import-file',
    accept: '.csv,.tsv,.txt,.json,text/csv,text/tab-separated-values,application/json',
    onchange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (f) await importFile(f);
    },
  });
  view.replaceChildren(
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'home-title' },
      h('h1', { id: 'home-title' }, t('home.title')),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          { type: 'button', class: 'primary', id: 'new-list', onclick: () => void newList() },
          t('home.new'),
        ),
        h('label', { class: 'file-btn', id: 'import-label' }, t('home.import'), fileInput),
        h(
          'button',
          { type: 'button', id: 'add-samples', onclick: () => void addSamples() },
          t('home.samples'),
        ),
      ),
      app.lib.lists.length === 0
        ? h('p', { id: 'home-empty' }, t('home.empty'))
        : h(
            'ul',
            { class: 'lists', id: 'lists' },
            app.lib.lists.map((l) => {
              const n = l.items.filter((i) => due.has(`${l.id}/${i.id}`)).length;
              return h(
                'li',
                { 'data-list': l.id },
                h('strong', { lang: l.lang }, l.name),
                h(
                  'span',
                  { class: 'meta' },
                  t('home.items', { n: l.items.length }),
                  n ? ` · ${t('home.due', { n })}` : '',
                ),
                h(
                  'span',
                  { class: 'toolbar' },
                  h('a', { href: `#/list/${l.id}`, class: 'file-btn' }, t('home.open')),
                  h('a', { href: `#/practice/${l.id}`, class: 'file-btn' }, t('home.practise')),
                ),
              );
            }),
          ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'data-title' },
      h('h2', { id: 'data-title' }, t('home.data')),
      h('p', { class: 'meta' }, t('home.backupNote')),
      h(
        'p',
        { class: 'meta' },
        h('span', { id: 'persist-status', role: 'status' }),
        ' ',
        h(
          'button',
          {
            type: 'button',
            id: 'persist-again',
            hidden: true,
            onclick: () => void askPersist(true),
          },
          t('persist.ask'),
        ),
      ),
      h(
        'p',
        { class: 'meta', id: 'last-backup' },
        app.settings.backup.lastAt
          ? t('backup.last', { d: app.settings.backup.lastAt.slice(0, 10) })
          : t('backup.never'),
      ),
      h('p', { class: 'meta', id: 'storage-use' }),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          {
            type: 'button',
            id: 'export-all',
            disabled: app.lib.lists.length === 0,
            onclick: () => void backupNow(),
          },
          t('home.exportAll'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'danger',
            id: 'wipe',
            onclick: async () => {
              if (!confirm(t('home.wipeConfirm'))) return;
              stopPractice();
              try {
                await app.store.wipe();
                // wipe() closes and deletes the database; start a fresh, empty one.
                app.store = await openStore();
                app.lib = { lists: [], attempts: [], srs: {} };
                app.recordings.clear();
                app.settings = loadSettings(undefined);
                applySettings();
                showBanner(t('home.wiped'));
              } catch (e) {
                showBanner(describeError(e), 'error');
              }
              route();
            },
          },
          t('home.wipe'),
        ),
      ),
    ),
  );
  updatePersistStatus();
  app.store
    .recordingBytes()
    .then((b) => {
      const el = document.getElementById('storage-use');
      if (el && b > 0) el.textContent = t('home.storage', { mb: (b / 1e6).toFixed(1) });
    })
    .catch(() => {});
}

/** A list shared by link: show what it holds; add it only when asked. */
function renderShare(code: string): void {
  let list: WordList;
  try {
    list = decodeShare(code, newId, nowIso());
  } catch (e) {
    view.replaceChildren(
      h(
        'section',
        { class: 'card' },
        h('h1', {}, t('share.title')),
        h('p', { class: 'bad', id: 'share-error' }, describeError(e)),
        h('a', { href: '#/' }, `← ${t('list.back')}`),
      ),
    );
    return;
  }
  view.replaceChildren(
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'share-title' },
      h('h1', { id: 'share-title' }, t('share.title')),
      h('p', {}, h('strong', { lang: list.lang, id: 'share-name' }, list.name)),
      h('p', { class: 'meta' }, t('home.items', { n: list.items.length })),
      h(
        'ol',
        { id: 'share-items', lang: list.lang },
        list.items.slice(0, 50).map((it) => h('li', {}, it.text)),
      ),
      list.items.length > 50 ? h('p', { class: 'meta' }, '…') : null,
      h('p', { class: 'note' }, t('share.note')),
      h(
        'div',
        { class: 'toolbar' },
        h(
          'button',
          {
            type: 'button',
            class: 'primary',
            id: 'share-add',
            onclick: async () => {
              try {
                assertListRoom();
              } catch (e) {
                showBanner(describeError(e), 'error');
                return;
              }
              app.lib.lists.push(list);
              if (await saveLibrary()) location.hash = `#/list/${list.id}`;
              else app.lib.lists.pop();
            },
          },
          t('share.add'),
        ),
        h('a', { href: '#/', class: 'file-btn' }, t('common.cancel')),
      ),
    ),
  );
}

function renderReview(): void {
  const items = reviewItems();
  view.replaceChildren(
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'review-title' },
      h('h1', { id: 'review-title' }, t('review.title')),
      items.length === 0
        ? h('p', { id: 'review-empty' }, t('review.empty'))
        : h(
            'div',
            {},
            h('p', {}, t('review.due', { n: items.length })),
            h(
              'ul',
              { class: 'lists', id: 'review-list' },
              items.map((s) =>
                h(
                  'li',
                  {},
                  h('strong', { lang: s.lang }, s.item.text),
                  h(
                    'span',
                    { class: 'meta' },
                    t('review.box', { b: app.lib.srs[`${s.listId}/${s.item.id}`]?.box ?? 1 }),
                  ),
                ),
              ),
            ),
            h(
              'div',
              { class: 'toolbar' },
              h(
                'a',
                { href: '#/practice/review', class: 'file-btn', id: 'review-start' },
                t('review.start'),
              ),
            ),
          ),
    ),
  );
}

// ---------------------------------------------------------------- routing

let lastRoute = '';

function route(): void {
  const hash = location.hash.replace(/\?.*$/, '');
  const [, page, id] = hash.match(/^#\/([a-z]*)\/?([\w-]*)/) ?? [];
  const key = `${page ?? ''}/${id ?? ''}`;
  if (key !== lastRoute) stopPractice();
  const changed = key !== lastRoute;
  lastRoute = key;
  updateNav();
  if (page === 'list' && id) renderEditor(view, id, route);
  else if (page === 'share' && id) renderShare(id);
  else if (page === 'voices') renderVoices(view);
  else if (page === 'practice' && id) {
    // Re-render the set-up screen only on navigation, never mid-dictation.
    if (changed || location.hash.includes('?')) renderPractice(view, id);
    if (location.hash.includes('?')) history.replaceState(null, '', `#/practice/${id}`);
  } else if (page === 'review') renderReview();
  else renderHome();
  updateReminder();
  if (changed) view.focus({ preventScroll: true });
}

async function boot(): Promise<void> {
  const v = byId('app-version').textContent ?? '';
  document.body.dataset.version = v;
  try {
    app.store = await openStore();
    const [lib, settings, keys] = await Promise.all([
      app.store.loadLibrary(),
      app.store.loadSettings(),
      app.store.recordingKeys(),
    ]);
    if (lib) app.lib = lib;
    app.settings = loadSettings(settings);
    if (settings === undefined && matchMedia('(prefers-color-scheme: dark)').matches)
      app.settings.theme = 'dark';
    app.recordings = new Set(keys);
  } catch (e) {
    showBanner(describeError(e), 'error');
  }
  applySettings();
  bindSettings();
  window.addEventListener('hashchange', route);
  document.addEventListener('dictalark:saved', () => {
    updateNav();
    updateReminder();
    void askPersist();
  });
  onVoicesChanged(() => {
    if (!location.hash.startsWith('#/practice/') || !document.querySelector('.run')) {
      const status = document.getElementById('voice-status');
      if (status) route();
    }
  });
  route();
  void askPersist();
  document.body.dataset.ready = 'true';
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && import.meta.env.PROD)
    navigator.serviceWorker.register('./sw.js').catch(() => {});
}

void boot();
