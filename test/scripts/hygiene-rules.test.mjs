// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { COMPETITORS, NETWORK_APIS, TEXTBOOK_MARKERS } from '../../scripts/lib/hygiene-rules.mjs';

describe('hygiene rule patterns', () => {
  it.each(['DictationEasy', 'Dictation Easy', '默書啦喂', 'Spelling Shed', 'SpellingCity'])(
    'flags the product name %s',
    (s) => expect(COMPETITORS.test(`see ${s} app`)).toBe(true),
  );
  it.each(['dictation practice', '默書練習', 'spelling list', 'easy words'])(
    'does not flag ordinary words: %s',
    (s) => expect(COMPETITORS.test(s)).toBe(false),
  );
  it.each(['P3 English Unit 4', '中文第三課', '教育局 小學學習字詞表', 'from the textbook'])(
    'flags textbook markers: %s',
    (s) => expect(TEXTBOOK_MARKERS.test(s)).toBe(true),
  );
  it.each(['Animals at the park', '公園裏的動物', 'Kitchen words'])(
    'does not flag self-written list titles: %s',
    (s) => expect(TEXTBOOK_MARKERS.test(s)).toBe(false),
  );
  it.each([
    'await fetch("/x")',
    'navigator.sendBeacon(u, d)',
    'new XMLHttpRequest()',
    'new WebSocket(u)',
  ])('flags network calls: %s', (s) => expect(NETWORK_APIS.test(s)).toBe(true));
  it('does not flag lookalike words', () => {
    expect(NETWORK_APIS.test('const prefetched = 1; refetchList')).toBe(false);
  });
});
