// SPDX-License-Identifier: AGPL-3.0-or-later
// Printable answer sheet, answer key and score sheet. The page's print styles hide
// everything except #print-area, which is filled just before window.print().

import type { ItemResult, WordList } from '@dictalark/core';
import { byId, h } from './dom';
import { t } from './strings';

export type PrintKind = 'sheet' | 'key';

function header(title: string): HTMLElement[] {
  return [
    h('h1', {}, title),
    h(
      'p',
      { class: 'print-meta' },
      h('span', {}, `${t('print.name')}: ____________________`),
      h('span', {}, `${t('print.date')}: ______________`),
      h('span', {}, `${t('print.score')}: ______`),
    ),
  ];
}

/** Fill the print area (exported for tests); returns it. */
export function fillList(list: WordList, kind: PrintKind): HTMLElement {
  const area = byId('print-area');
  const title = `${list.name} · ${t(kind === 'sheet' ? 'print.sheetTitle' : 'print.keyTitle')}`;
  area.replaceChildren(
    h(
      'div',
      { class: 'print-doc', 'data-kind': kind },
      header(title),
      h(
        'ol',
        { lang: list.lang },
        list.items.map((it) =>
          kind === 'sheet'
            ? h('li', {}, '')
            : h(
                'li',
                { lang: it.lang ?? list.lang },
                it.text,
                it.accept.length ? h('span', { class: 'alt' }, `(${it.accept.join(' / ')})`) : null,
              ),
        ),
      ),
      h('p', { class: 'footer-note' }, 'Dictalark · 默書雲雀'),
    ),
  );
  return area;
}

export function fillScore(
  title: string,
  rows: { text: string; lang: string; result: ItemResult | undefined; answer?: string }[],
): HTMLElement {
  const area = byId('print-area');
  const right = rows.filter((r) => r.result === 'right').length;
  const typed = rows.some((r) => r.answer !== undefined);
  area.replaceChildren(
    h(
      'div',
      { class: 'print-doc', 'data-kind': 'score' },
      h('h1', {}, `${title} · ${t('print.scoreTitle')}`),
      h('p', { class: 'print-meta' }, t('results.score', { r: right, n: rows.length })),
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, '#'),
            h('th', {}, t('results.expected')),
            typed ? h('th', {}, t('results.yours')) : null,
            h('th', {}, t('print.mark')),
          ),
        ),
        h(
          'tbody',
          {},
          rows.map((r, i) =>
            h(
              'tr',
              {},
              h('td', {}, String(i + 1)),
              h('td', { lang: r.lang }, r.text),
              typed ? h('td', { lang: r.lang }, r.answer ?? '') : null,
              h(
                'td',
                {},
                r.result === 'right'
                  ? '✓'
                  : r.result === 'wrong'
                    ? '✗'
                    : r.result === 'blank'
                      ? '—'
                      : '',
              ),
            ),
          ),
        ),
      ),
      h('p', { class: 'footer-note' }, `${t('footer.marking')} · Dictalark · 默書雲雀`),
    ),
  );
  return area;
}

export function printNow(): void {
  window.print();
}
