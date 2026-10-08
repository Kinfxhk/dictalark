// SPDX-License-Identifier: AGPL-3.0-or-later
// Class page: teachers send lists as a file and read pupils' results files; pupils open a
// class pack and save a results file. Files only: no accounts, no server, nothing uploaded.

import {
  applyPack,
  decodeUtf8,
  DictalarkError,
  LIMITS,
  makeResults,
  MAX_RESULTS_FILES,
  parsePack,
  parseResults,
  planPack,
  serializePack,
  serializeResults,
  stringifyCsv,
  summariseResults,
  summaryRows,
  type ClassPack,
  type ClassResults,
  type ClassSummary,
} from '@dictalark/core';
import { app, describeError, nowIso, saveLibrary, showBanner } from './app';
import { download, fileName, h } from './dom';
import { t } from './strings';

let pending: ClassPack | null = null;
let summary: ClassSummary | null = null;

async function readText(file: File): Promise<string> {
  if (file.size > LIMITS.importBytes)
    throw new DictalarkError('too-large', { max: LIMITS.importBytes });
  return decodeUtf8(new Uint8Array(await file.arrayBuffer()), LIMITS.importBytes);
}

function listPicker(prefix: string): HTMLElement {
  return h(
    'fieldset',
    { id: `${prefix}-lists` },
    h('legend', {}, t('class.chooseLists')),
    app.lib.lists.length === 0
      ? h('p', { class: 'note' }, t('class.noLists'))
      : app.lib.lists.map((l, i) =>
          h(
            'label',
            { class: 'check' },
            h('input', { type: 'checkbox', id: `${prefix}-list-${i}`, value: l.id }),
            ' ',
            h('span', { lang: l.lang }, l.name),
          ),
        ),
  );
}

const picked = (prefix: string): string[] =>
  [...document.querySelectorAll<HTMLInputElement>(`#${prefix}-lists input:checked`)].map(
    (x) => x.value,
  );

function teacherSend(): HTMLElement {
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'class-send-title', id: 'class-send' },
    h('h2', { id: 'class-send-title' }, t('class.sendTitle')),
    h('p', {}, t('class.sendHelp')),
    listPicker('send'),
    h(
      'label',
      {},
      t('class.packTitle'),
      h('input', { type: 'text', id: 'pack-title', maxlength: String(LIMITS.nameChars) }),
    ),
    h(
      'label',
      {},
      t('class.packNote'),
      h('textarea', { id: 'pack-note', rows: '2', maxlength: '500' }),
    ),
    h(
      'button',
      {
        type: 'button',
        id: 'pack-save',
        onclick: () => {
          try {
            const ids = new Set(picked('send'));
            const lists = app.lib.lists.filter((l) => ids.has(l.id));
            if (lists.length === 0) throw new Error(t('class.pickOne'));
            const title = (document.getElementById('pack-title') as HTMLInputElement).value;
            const note = (document.getElementById('pack-note') as HTMLTextAreaElement).value;
            const text = serializePack(lists, { title, note }, nowIso());
            download(fileName(title || 'class', 'dictalark-pack.json'), text, 'application/json');
            showBanner(t('class.packSaved', { n: lists.length }));
          } catch (e) {
            showBanner(
              e instanceof DictalarkError ? describeError(e) : String((e as Error).message),
              'error',
            );
          }
        },
      },
      t('class.packSave'),
    ),
  );
}

function pupilOpen(rerender: () => void): HTMLElement {
  const preview: (HTMLElement | string)[] = [];
  if (pending) {
    try {
      const plan = planPack(app.lib, pending);
      const names = (ls: { name: string }[]) => ls.map((l) => l.name).join('、') || '—';
      preview.push(
        h(
          'div',
          { id: 'pack-preview', class: 'preview' },
          h('p', {}, h('strong', { id: 'pack-preview-title' }, pending.title)),
          pending.note ? h('p', { id: 'pack-preview-note' }, pending.note) : '',
          h('p', { id: 'pack-added' }, t('class.willAdd', { names: names(plan.added) })),
          h('p', { id: 'pack-updated' }, t('class.willUpdate', { names: names(plan.updated) })),
          h('p', { id: 'pack-unchanged' }, t('class.unchanged', { names: names(plan.unchanged) })),
          h(
            'button',
            {
              type: 'button',
              class: 'primary',
              id: 'pack-apply',
              onclick: async () => {
                const before = app.lib;
                try {
                  const out = applyPack(app.lib, pending!, nowIso());
                  app.lib = { lists: out.lists, attempts: out.attempts, srs: out.srs };
                  if (!(await saveLibrary())) {
                    app.lib = before;
                    return;
                  }
                  showBanner(
                    t('class.applied', { added: out.added.length, updated: out.updated.length }),
                  );
                  pending = null;
                } catch (e) {
                  app.lib = before;
                  showBanner(describeError(e), 'error');
                }
                rerender();
              },
            },
            t('class.apply'),
          ),
          ' ',
          h(
            'button',
            {
              type: 'button',
              id: 'pack-cancel',
              onclick: () => {
                pending = null;
                rerender();
              },
            },
            t('class.cancel'),
          ),
        ),
      );
    } catch (e) {
      preview.push(h('p', { class: 'bad', id: 'pack-error' }, describeError(e)));
    }
  }
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'class-open-title', id: 'class-open' },
    h('h2', { id: 'class-open-title' }, t('class.openTitle')),
    h('p', {}, t('class.openHelp')),
    h(
      'label',
      { class: 'file-btn', id: 'pack-open-label' },
      t('class.openPack'),
      h('input', {
        type: 'file',
        id: 'pack-file',
        accept: '.json,application/json',
        onchange: async (e: Event) => {
          const input = e.target as HTMLInputElement;
          const f = input.files?.[0];
          input.value = '';
          if (!f) return;
          try {
            pending = parsePack(await readText(f));
          } catch (err) {
            pending = null;
            showBanner(describeError(err), 'error');
          }
          rerender();
        },
      }),
    ),
    preview,
  );
}

function pupilResults(): HTMLElement {
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'class-results-title', id: 'class-results' },
    h('h2', { id: 'class-results-title' }, t('class.resultsTitle')),
    h('p', {}, t('class.resultsHelp')),
    listPicker('res'),
    h(
      'label',
      {},
      t('class.pupilName'),
      h('input', { type: 'text', id: 'pupil-name', maxlength: String(LIMITS.nameChars) }),
    ),
    h(
      'button',
      {
        type: 'button',
        id: 'results-save',
        onclick: () => {
          try {
            const ids = picked('res');
            if (ids.length === 0) throw new Error(t('class.pickOne'));
            const pupil = (document.getElementById('pupil-name') as HTMLInputElement).value;
            const r = makeResults(app.lib, ids, pupil, nowIso());
            download(
              fileName(`${r.pupil}-results`, 'dictalark-results.json'),
              serializeResults(r),
              'application/json',
            );
            showBanner(t('class.resultsSaved'));
          } catch (e) {
            showBanner(
              e instanceof DictalarkError ? describeError(e) : String((e as Error).message),
              'error',
            );
          }
        },
      },
      t('class.resultsSave'),
    ),
  );
}

const score = (x: { right: number; total: number } | null) => (x ? `${x.right}/${x.total}` : '—');

function teacherRead(rerender: () => void): HTMLElement {
  const out: HTMLElement[] = [];
  if (summary) {
    const s = summary;
    out.push(
      h(
        'p',
        { id: 'summary-pupils' },
        t('class.summaryPupils', { n: s.pupils.length }),
        s.replaced ? ` ${t('class.summaryReplaced', { n: s.replaced })}` : '',
      ),
    );
    s.lists.forEach((l, li) =>
      out.push(
        h(
          'div',
          { class: 'summary', 'data-list': l.listId },
          h('h3', {}, l.name),
          h(
            'p',
            {},
            t('class.summaryTried', { tried: l.tried, n: l.rows.length, all: l.allRight }),
          ),
          h(
            'table',
            { id: `summary-table-${li}` },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', { scope: 'col' }, t('class.colPupil')),
                h('th', { scope: 'col' }, t('class.colTries')),
                h('th', { scope: 'col' }, t('class.colBest')),
                h('th', { scope: 'col' }, t('class.colLast')),
              ),
            ),
            h(
              'tbody',
              {},
              l.rows.map((r) =>
                h(
                  'tr',
                  {},
                  h('th', { scope: 'row' }, r.pupil),
                  h('td', {}, String(r.tries)),
                  h('td', {}, score(r.best)),
                  h('td', {}, r.last ? `${score(r.last)} (${r.last.day})` : '—'),
                ),
              ),
            ),
          ),
          l.missed.length
            ? h(
                'p',
                { class: 'missed', id: `summary-missed-${li}` },
                t('class.missed'),
                ' ',
                l.missed
                  .slice(0, 10)
                  .map((w) => t('class.missedWord', { text: w.text, n: w.pupils }))
                  .join('，'),
              )
            : '',
        ),
      ),
    );
    out.push(
      h(
        'button',
        {
          type: 'button',
          id: 'summary-csv',
          onclick: () =>
            download(
              'class-summary.csv',
              '\ufeff' + stringifyCsv(summaryRows(s)),
              'text/csv;charset=utf-8',
            ),
        },
        t('class.summaryCsv'),
      ),
    );
  }
  return h(
    'section',
    { class: 'card', 'aria-labelledby': 'class-read-title', id: 'class-read' },
    h('h2', { id: 'class-read-title' }, t('class.readTitle')),
    h('p', {}, t('class.readHelp')),
    h('p', { class: 'note' }, t('class.honesty')),
    h(
      'label',
      { class: 'file-btn', id: 'results-open-label' },
      t('class.openResults'),
      h('input', {
        type: 'file',
        id: 'results-files',
        multiple: true,
        accept: '.json,application/json',
        onchange: async (e: Event) => {
          const input = e.target as HTMLInputElement;
          const files = [...(input.files ?? [])];
          input.value = '';
          if (files.length === 0) return;
          try {
            if (files.length > MAX_RESULTS_FILES)
              throw new DictalarkError('too-many-items', { path: 'files', max: MAX_RESULTS_FILES });
            const parsed: ClassResults[] = [];
            for (const f of files) {
              try {
                parsed.push(parseResults(await readText(f)));
              } catch (err) {
                throw new Error(`${f.name}: ${describeError(err)}`, { cause: err });
              }
            }
            summary = summariseResults(parsed);
          } catch (err) {
            summary = null;
            showBanner(
              err instanceof DictalarkError ? describeError(err) : String((err as Error).message),
              'error',
            );
          }
          rerender();
        },
      }),
    ),
    out,
  );
}

export function renderClass(view: HTMLElement): void {
  const rerender = () => renderClass(view);
  view.replaceChildren(
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'class-title' },
      h('h1', { id: 'class-title' }, t('class.title')),
      h('p', {}, t('class.intro')),
    ),
    teacherSend(),
    pupilOpen(rerender),
    pupilResults(),
    teacherRead(rerender),
  );
}
