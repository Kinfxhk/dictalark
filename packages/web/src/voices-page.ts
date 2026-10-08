// SPDX-License-Identifier: AGPL-3.0-or-later
// Voices on this device: every voice the browser offers, with its language and whether it
// is on the device or online. Each can be tried, and chosen as the one to use for its
// language. Online voices are only tried when the user has allowed them in settings.

import { normTag, type VoiceInfo } from '@dictalark/core';
import { app, saveSettings, showBanner } from './app';
import { h } from './dom';
import { listVoices, speaker } from './env';
import { t } from './strings';

/** A short, self-written test sentence in the voice's language. */
export function sampleText(lang: string): string {
  const tag = normTag(lang);
  if (tag.startsWith('yue') || tag === 'zh-hk' || tag === 'zh-mo')
    return '你好，我會讀出今日的默書詞語。';
  if (tag.startsWith('zh') || tag.startsWith('cmn')) return '你好，我會讀出今天的默寫詞語。';
  if (tag.startsWith('en')) return 'Hello, I will read out your spelling words.';
  return 'Dictalark 1 2 3';
}

/** Choose `name` for its language; any other chosen voice of the same language is dropped. */
export function choosePreferred(
  preferred: readonly string[],
  voices: readonly VoiceInfo[],
  name: string,
): string[] {
  const langOf = (n: string) => normTag(voices.find((v) => v.name === n)?.lang ?? '');
  const lang = langOf(name);
  return [...preferred.filter((n) => n !== name && (lang === '' || langOf(n) !== lang)), name];
}

export function renderVoices(view: HTMLElement): void {
  const voices = [...listVoices()].sort(
    (a, b) => normTag(a.lang).localeCompare(normTag(b.lang)) || a.name.localeCompare(b.name),
  );
  const rows = voices.map((v, i) => {
    const chosen = app.settings.preferredVoices.includes(v.name);
    const online = !v.localService;
    const blocked = online && !app.settings.allowRemoteVoices;
    return h(
      'tr',
      { 'data-voice': v.name, 'data-chosen': chosen ? 'true' : 'false' },
      h('td', {}, v.name),
      h('td', {}, v.lang),
      h('td', {}, online ? t('voices.online') : t('voices.local')),
      h(
        'td',
        {},
        h(
          'button',
          {
            type: 'button',
            id: `voice-try-${i}`,
            disabled: blocked,
            title: blocked ? t('settings.remoteHelp') : undefined,
            onclick: () => {
              speaker.cancel();
              void speaker.speak(sampleText(v.lang), v.lang, v, app.settings.rate);
            },
          },
          `▶ ${t('voices.try')}`,
        ),
        ' ',
        h(
          'button',
          {
            type: 'button',
            id: `voice-use-${i}`,
            'aria-pressed': chosen ? 'true' : 'false',
            onclick: async () => {
              app.settings.preferredVoices = chosen
                ? app.settings.preferredVoices.filter((n) => n !== v.name)
                : choosePreferred(app.settings.preferredVoices, voices, v.name);
              await saveSettings();
              showBanner(chosen ? t('voices.cleared') : t('voices.chosen', { name: v.name }));
              renderVoices(view);
            },
          },
          chosen ? `✓ ${t('voices.inUse')}` : t('voices.use'),
        ),
      ),
    );
  });
  view.replaceChildren(
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'voices-title' },
      h('h1', { id: 'voices-title' }, t('voices.title')),
      h('p', { class: 'meta' }, t('voices.intro')),
      voices.length === 0
        ? h('p', { id: 'voices-empty' }, t('voices.none'))
        : h(
            'table',
            { id: 'voices-table' },
            h(
              'thead',
              {},
              h(
                'tr',
                {},
                h('th', {}, t('voices.name')),
                h('th', {}, t('voices.lang')),
                h('th', {}, t('voices.where')),
                h('th', {}, ''),
              ),
            ),
            h('tbody', {}, rows),
          ),
    ),
  );
}
