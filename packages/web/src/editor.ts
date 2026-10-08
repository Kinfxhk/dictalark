// SPDX-License-Identifier: AGPL-3.0-or-later
// Word-list editor: name, subject, reading language, items, accepted answers, notes and
// the parent's own recordings (stored only in this browser).

import {
  findDuplicates,
  LIMITS,
  listToCsv,
  pickVoice,
  SUBJECTS,
  validateLang,
  validateText,
  type Item,
  type Subject,
  type WordList,
} from '@dictalark/core';
import {
  app,
  deleteList,
  describeError,
  findList,
  nowIso,
  recKey,
  saveLibrary,
  showBanner,
} from './app';
import { download, fileName, h, newId } from './dom';
import { canRecord, listVoices, playRecording, record, stopAudio } from './env';
import { fillList, printNow } from './print';
import { getLocale, t, type StringKey } from './strings';
import type { ActiveRecording } from './recorder';

export const LANGS = ['en-GB', 'en-US', 'yue-HK', 'zh-TW', 'zh-Hans-CN'] as const;
export const DEFAULT_LANG: Record<Subject, string> = {
  english: 'en-GB',
  chinese: 'yue-HK',
  mandarin: 'zh-TW',
  other: 'en-GB',
};

const GUIDE = 'https://github.com/Kinfxhk/dictalark/blob/main/docs/';

let active: { key: string; rec: ActiveRecording } | undefined;

export function voiceStatus(lang: string): HTMLElement {
  const choice = pickVoice(listVoices(), lang, { allowRemote: app.settings.allowRemoteVoices });
  const text =
    choice.quality === 'exact'
      ? t('voice.exact', { name: choice.voice!.name })
      : choice.quality === 'mismatch'
        ? t('voice.mismatch', { name: choice.voice!.name, lang: choice.voice!.lang })
        : t('voice.none');
  return h(
    'p',
    { class: 'voice-status', id: 'voice-status', 'data-quality': choice.quality, role: 'status' },
    text,
    choice.remoteSkipped ? ` ${t('voice.remoteSkipped')}` : '',
    choice.quality === 'exact'
      ? null
      : h(
          'a',
          {
            href: `${GUIDE}${getLocale() === 'en' ? 'guide.md' : 'guide.zh-Hant.md'}`,
            target: '_blank',
            rel: 'noopener noreferrer',
            class: 'voice-help',
          },
          ` ${t('voice.help')}`,
        ),
  );
}

function touch(list: WordList): void {
  list.updatedAt = nowIso();
}

/** Apply a text edit with validation; returns false (and shows why) when it is refused. */
function tryText(value: string, max: number, allowEmpty: boolean): string | undefined {
  try {
    return validateText(value, 'text', { max, allowEmpty });
  } catch (e) {
    showBanner(describeError(e), 'error');
    return undefined;
  }
}

export function renderEditor(view: HTMLElement, listId: string, rerender: () => void): void {
  const list = findList(listId);
  if (!list) {
    location.hash = '#/';
    return;
  }
  const dupIndex = new Set(findDuplicates(list.items.map((i) => i.text)).flat());
  const save = async () => {
    touch(list);
    if (await saveLibrary()) showBanner(t('list.save'));
  };

  const subject = h(
    'select',
    {
      id: 'list-subject',
      onchange: async (e: Event) => {
        const s = (e.target as HTMLSelectElement).value as Subject;
        const wasDefault = list.lang === DEFAULT_LANG[list.subject];
        list.subject = s;
        if (wasDefault) list.lang = DEFAULT_LANG[s];
        await save();
        rerender();
      },
    },
    SUBJECTS.map((s) =>
      h('option', { value: s, selected: list.subject === s }, t(`subject.${s}` as StringKey)),
    ),
  );
  const langSel = h(
    'select',
    {
      id: 'list-lang',
      onchange: async (e: Event) => {
        list.lang = validateLang((e.target as HTMLSelectElement).value, 'lang');
        await save();
        rerender();
      },
    },
    [...new Set([...LANGS, list.lang])].map((l) =>
      h(
        'option',
        { value: l, selected: list.lang === l },
        (LANGS as readonly string[]).includes(l) ? t(`lang.${l}` as StringKey) : l,
      ),
    ),
  );

  const addBox = h('textarea', { id: 'add-words', rows: 4, lang: list.lang });
  const addBtn = h(
    'button',
    {
      type: 'button',
      id: 'add-btn',
      class: 'primary',
      onclick: async () => {
        const lines = addBox.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (list.items.length >= LIMITS.itemsPerList) {
            showBanner(t('list.full', { n: LIMITS.itemsPerList }), 'error');
            break;
          }
          const text = tryText(line, LIMITS.itemChars, false);
          if (text === undefined) return;
          list.items.push({ id: newId(), text, accept: [], note: '' });
        }
        await save();
        rerender();
        document.getElementById('add-words')?.focus();
      },
    },
    t('list.addBtn'),
  );

  const rows = list.items.map((item, i) => itemRow(list, item, i, dupIndex.has(i), save, rerender));

  view.replaceChildren(
    h('p', {}, h('a', { href: '#/' }, `← ${t('list.back')}`)),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'list-title' },
      h('h1', { id: 'list-title' }, list.name),
      h(
        'div',
        { class: 'form-grid' },
        h(
          'label',
          {},
          t('list.name'),
          h('input', {
            type: 'text',
            id: 'list-name',
            value: list.name,
            maxlength: LIMITS.nameChars,
            onchange: async (e: Event) => {
              const v = tryText((e.target as HTMLInputElement).value, LIMITS.nameChars, false);
              if (v === undefined) return;
              list.name = v;
              await save();
              rerender();
            },
          }),
        ),
        h('label', {}, t('list.subject'), subject),
        h('label', {}, t('list.lang'), langSel),
      ),
      voiceStatus(list.lang),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'add-title' },
      h('h2', { id: 'add-title' }, h('label', { for: 'add-words' }, t('list.add'))),
      addBox,
      h('div', { class: 'toolbar' }, addBtn),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'items-title' },
      h('h2', { id: 'items-title' }, `${t('list.items')} (${list.items.length})`),
      list.items.length
        ? h(
            'table',
            { id: 'items-table' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, '#'),
                h('th', {}, t('list.word')),
                h('th', {}, t('list.accept')),
                h('th', {}, t('list.note')),
                h('th', {}, t('list.recording')),
                h('th', {}, ''),
              ),
            ),
            h('tbody', {}, rows),
          )
        : null,
      h(
        'div',
        { class: 'toolbar' },
        h(
          'a',
          { href: `#/practice/${list.id}`, class: 'file-btn', id: 'practise-link' },
          t('home.practise'),
        ),
        h(
          'button',
          {
            type: 'button',
            id: 'print-sheet',
            disabled: list.items.length === 0,
            onclick: () => {
              fillList(list, 'sheet');
              printNow();
            },
          },
          t('print.sheet'),
        ),
        h(
          'button',
          {
            type: 'button',
            id: 'print-key',
            disabled: list.items.length === 0,
            onclick: () => {
              fillList(list, 'key');
              printNow();
            },
          },
          t('print.key'),
        ),
        h(
          'button',
          {
            type: 'button',
            id: 'csv-btn',
            onclick: () =>
              download(fileName(list.name, 'csv'), listToCsv(list), 'text/csv;charset=utf-8'),
          },
          t('list.exportCsv'),
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'danger',
            id: 'delete-list',
            onclick: async () => {
              if (!confirm(t('list.deleteConfirm'))) return;
              await deleteList(list.id);
              location.hash = '#/';
            },
          },
          t('list.delete'),
        ),
      ),
    ),
  );
}

function itemRow(
  list: WordList,
  item: Item,
  i: number,
  dup: boolean,
  save: () => Promise<void>,
  rerender: () => void,
): HTMLTableRowElement {
  const key = recKey(list.id, item.id);
  const has = app.recordings.has(key);
  const recording = active?.key === key;
  const lang = item.lang ?? list.lang;
  const text = h('input', {
    type: 'text',
    id: `item-text-${i}`,
    value: item.text,
    lang,
    'aria-label': `${t('list.word')} ${i + 1}`,
    onchange: async (e: Event) => {
      const v = tryText((e.target as HTMLInputElement).value, LIMITS.itemChars, false);
      if (v === undefined) return;
      item.text = v;
      await save();
      rerender();
    },
  });
  const accept = h('input', {
    type: 'text',
    id: `item-accept-${i}`,
    value: item.accept.join(' | '),
    lang,
    'aria-label': `${t('list.accept')} ${i + 1}`,
    onchange: async (e: Event) => {
      const parts = (e.target as HTMLInputElement).value
        .split('|')
        .map((s) => s.trim())
        .filter(Boolean);
      const out: string[] = [];
      for (const p of parts.slice(0, LIMITS.acceptPerItem)) {
        const v = tryText(p, LIMITS.itemChars, false);
        if (v === undefined) return;
        out.push(v);
      }
      item.accept = out;
      await save();
    },
  });
  const note = h('input', {
    type: 'text',
    id: `item-note-${i}`,
    value: item.note,
    'aria-label': `${t('list.note')} ${i + 1}`,
    onchange: async (e: Event) => {
      const v = tryText((e.target as HTMLInputElement).value, LIMITS.itemChars, true);
      if (v === undefined) return;
      item.note = v;
      await save();
    },
  });

  const recBtn = h(
    'button',
    {
      type: 'button',
      id: `rec-${i}`,
      'aria-pressed': recording ? 'true' : 'false',
      disabled: !canRecord() || (active !== undefined && !recording),
      onclick: async () => {
        if (active?.key === key) {
          active.rec.stop();
          return;
        }
        try {
          stopAudio();
          const rec = await record();
          active = { key, rec };
          showBanner(t('list.recordingNow', { n: LIMITS.recordingSeconds }));
          rerender();
          const result = await rec.done;
          await app.store.putRecording(key, result);
          app.recordings.add(key);
          showBanner(t('list.recSaved'));
        } catch (e) {
          showBanner(describeError(e), 'error');
        } finally {
          active = undefined;
          rerender();
        }
      },
    },
    recording ? `■ ${t('list.stop')}` : `● ${t('list.record')}`,
  );
  const playBtn = h(
    'button',
    {
      type: 'button',
      id: `play-${i}`,
      hidden: !has,
      onclick: async () => {
        const rec = await app.store.getRecording(key);
        if (rec) await playRecording(rec);
      },
    },
    `▶ ${t('list.play')}`,
  );
  const delRec = h(
    'button',
    {
      type: 'button',
      id: `delrec-${i}`,
      hidden: !has,
      'aria-label': `${t('list.deleteRec')} ${i + 1}`,
      onclick: async () => {
        try {
          await app.store.deleteRecording(key);
          app.recordings.delete(key);
        } catch (e) {
          showBanner(describeError(e), 'error');
        }
        rerender();
      },
    },
    '✕',
  );
  return h(
    'tr',
    { class: dup ? 'dup' : '', 'data-has-recording': has ? 'true' : 'false' },
    h('td', {}, String(i + 1)),
    h('td', {}, text, dup ? h('span', { class: 'tag' }, t('list.duplicate')) : null),
    h('td', {}, accept),
    h('td', {}, note),
    h('td', {}, recBtn, ' ', playBtn, ' ', delRec),
    h(
      'td',
      {},
      h(
        'button',
        {
          type: 'button',
          id: `del-${i}`,
          class: 'danger',
          'aria-label': `${t('list.deleteItem')} ${i + 1}`,
          onclick: async () => {
            list.items = list.items.filter((x) => x.id !== item.id);
            delete app.lib.srs[key];
            await save();
            if (app.recordings.has(key)) {
              await app.store.deleteRecording(key).catch(() => {});
              app.recordings.delete(key);
            }
            rerender();
          },
        },
        t('list.deleteItem'),
      ),
    ),
  );
}
