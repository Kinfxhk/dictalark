// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Library, WordList } from '../../src/index';

export const T0 = '2026-10-08T02:00:00Z';

export function list(over: Partial<WordList> = {}): WordList {
  return {
    id: 'list-1',
    name: 'Kitchen words',
    subject: 'english',
    lang: 'en-GB',
    items: [
      { id: 'i1', text: 'spoon', accept: [], note: '' },
      { id: 'i2', text: 'colour', accept: ['color'], note: 'UK spelling first' },
      { id: 'i3', text: '茶壺', accept: [], note: '', lang: 'yue-HK' },
    ],
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function library(over: Partial<Library> = {}): Library {
  return {
    lists: [list()],
    attempts: [
      {
        id: 'a1',
        listId: 'list-1',
        day: '2026-10-08',
        mode: 'typing',
        entries: [
          { itemId: 'i1', result: 'right', answer: 'spoon' },
          { itemId: 'i2', result: 'wrong', answer: 'colur' },
        ],
      },
    ],
    srs: { 'list-1/i2': { box: 1, due: '2026-10-08' } },
    ...over,
  };
}
