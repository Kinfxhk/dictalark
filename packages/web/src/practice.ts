// SPDX-License-Identifier: AGPL-3.0-or-later
// Practice: set-up, the dictation itself (paper / typing / flash cards) and the results.

import {
  CheckerRejected,
  dueKeys,
  mark,
  MAX_SEED,
  MODES,
  shuffle,
  validatePlayerConfig,
  type ItemResult,
  type MarkResult,
  type Mode,
  type Op,
} from '@dictalark/core';
import { app, findList, recordResults, saveSettings, showBanner, today } from './app';
import { h, newId } from './dom';
import { voiceStatus } from './editor';
import { createSession, readAloud, type Session, type SessionItem } from './session';
import { fillScore, printNow } from './print';
import { t, type StringKey } from './strings';

let current: Session | undefined;

/** Stop any running dictation (called when the route changes). */
export function stopPractice(): void {
  current?.dispose();
  current = undefined;
}

export function reviewItems(): SessionItem[] {
  const out: SessionItem[] = [];
  for (const key of dueKeys(app.lib.srs, today())) {
    const [listId, itemId] = key.split('/');
    const list = findList(listId!);
    const item = list?.items.find((i) => i.id === itemId);
    if (list && item) out.push({ listId: list.id, item, lang: item.lang ?? list.lang });
  }
  return out;
}

function itemsFor(
  target: string,
): { title: string; items: SessionItem[]; lang: string } | undefined {
  if (target === 'review') {
    const items = reviewItems();
    return { title: t('review.title'), items, lang: items[0]?.lang ?? 'en-GB' };
  }
  const list = findList(target);
  if (!list) return undefined;
  return {
    title: t('practice.title', { name: list.name }),
    items: list.items.map((item) => ({ listId: list.id, item, lang: item.lang ?? list.lang })),
    lang: list.lang,
  };
}

const randomSeed = () => (crypto.getRandomValues(new Uint32Array(1))[0]! % MAX_SEED) + 1;

function numberField(
  id: string,
  label: StringKey,
  value: number,
  min: number,
  max: number,
  step = 1,
) {
  return h(
    'label',
    {},
    t(label),
    h('input', { type: 'number', id, value, min, max, step, inputmode: 'decimal' }),
  );
}

export function renderPractice(view: HTMLElement, target: string): void {
  stopPractice();
  const src = itemsFor(target);
  if (!src) {
    location.hash = '#/';
    return;
  }
  const st = app.settings;
  const seed = randomSeed();
  const modeRadios = MODES.map((m) =>
    h(
      'label',
      { class: 'check' },
      h('input', {
        type: 'radio',
        name: 'mode',
        id: `mode-${m}`,
        value: m,
        checked: st.mode === m,
      }),
      ' ',
      t(`mode.${m}` as StringKey),
    ),
  );
  const form = h(
    'form',
    {
      id: 'practice-form',
      onsubmit: (e: Event) => {
        e.preventDefault();
        const get = (id: string) => document.getElementById(id) as HTMLInputElement;
        const num = (id: string) => Number(get(id).value);
        try {
          const player = validatePlayerConfig({
            repeats: num('opt-repeats'),
            gapSeconds: num('opt-gap'),
            itemGapSeconds: num('opt-itemgap'),
            countdownSeconds: num('opt-countdown'),
          });
          const rate = num('opt-rate');
          if (!(rate >= 0.5 && rate <= 1.5)) throw new Error('rate');
          const seedValue = num('opt-seed');
          if (!Number.isInteger(seedValue) || seedValue < 0 || seedValue > MAX_SEED)
            throw new Error('seed');
          const mode = (form.querySelector('input[name=mode]:checked') as HTMLInputElement)
            .value as Mode;
          Object.assign(st, {
            player,
            rate,
            mode,
            shuffle: get('opt-shuffle').checked,
            hideText: get('opt-hide').checked,
            readPunctuation: get('opt-punct').checked,
          });
          void saveSettings();
          const items = st.shuffle ? shuffle(src.items, seedValue) : [...src.items];
          start(view, src.title, items, mode, target);
        } catch {
          showBanner(t('practice.invalid'), 'error');
        }
      },
    },
    h('fieldset', {}, h('legend', {}, t('practice.mode')), modeRadios),
    h(
      'div',
      { class: 'form-grid' },
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', id: 'opt-shuffle', checked: st.shuffle }),
        ' ',
        t('practice.shuffle'),
      ),
      numberField('opt-seed', 'practice.seed', seed, 0, MAX_SEED),
      numberField('opt-repeats', 'practice.repeats', st.player.repeats, 1, 5),
      numberField('opt-gap', 'practice.gap', st.player.gapSeconds, 0, 20),
      numberField('opt-itemgap', 'practice.itemGap', st.player.itemGapSeconds, 0, 60),
      numberField('opt-countdown', 'practice.countdown', st.player.countdownSeconds, 0, 10),
      numberField('opt-rate', 'practice.rate', st.rate, 0.5, 1.5, 0.1),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', id: 'opt-hide', checked: st.hideText }),
        ' ',
        t('practice.hide'),
      ),
      h(
        'label',
        { class: 'check' },
        h('input', { type: 'checkbox', id: 'opt-punct', checked: st.readPunctuation }),
        ' ',
        t('practice.punct'),
      ),
    ),
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        { type: 'submit', class: 'primary', id: 'btn-start', disabled: src.items.length === 0 },
        t('practice.start'),
      ),
    ),
  );
  view.replaceChildren(
    h(
      'p',
      {},
      h(
        'a',
        { href: target === 'review' ? '#/review' : `#/list/${target}` },
        `← ${t('list.back')}`,
      ),
    ),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'practice-title' },
      h('h1', { id: 'practice-title' }, src.title),
      h('p', { class: 'meta' }, t('home.items', { n: src.items.length })),
      voiceStatus(src.lang),
      form,
    ),
  );
}

function start(
  view: HTMLElement,
  title: string,
  items: SessionItem[],
  mode: Mode,
  target: string,
): void {
  if (mode === 'cards') return runCards(view, title, items, target);
  const typing = mode === 'typing';
  const answers: string[] = items.map(() => '');
  let shown = false;
  let shownIndex = -1;
  const counter = h('p', { class: 'counter', id: 'run-counter' });
  const status = h('p', {
    class: 'status',
    id: 'run-status',
    role: 'status',
    'aria-live': 'polite',
  });
  const word = h('p', { class: 'word', id: 'run-word' });
  const answer = h('input', {
    type: 'text',
    id: 'answer',
    class: 'answer',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-label': t('run.answer'),
  });
  const btn = (id: string, key: StringKey, fn: () => void) =>
    h('button', { type: 'button', id, onclick: fn }, t(key));
  const pause = btn('btn-pause', 'run.pause', () => {
    const p = session.view.state.phase;
    session.dispatch({ type: p === 'paused' ? 'resume' : 'pause' });
  });
  const readDone = h(
    'button',
    {
      type: 'button',
      id: 'btn-readdone',
      class: 'primary',
      hidden: true,
      onclick: () => session.readDone(),
    },
    t('run.readDone'),
  );
  const show = btn('btn-show', 'run.show', () => {
    shown = !shown;
    update();
  });
  show.hidden = typing;
  let idx = 0;
  const saveAnswer = () => {
    if (typing) answers[idx] = answer.value;
  };
  answer.addEventListener('input', saveAnswer);
  answer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      saveAnswer();
      session.dispatch({ type: 'next' });
    }
  });

  function update() {
    const s = session.view.state;
    if (s.index !== idx) {
      saveAnswer();
      idx = s.index;
      answer.value = answers[idx] ?? '';
      answer.lang = items[idx]?.lang ?? '';
    }
    if (shownIndex !== idx) {
      shown = false;
      shownIndex = idx;
    }
    const item = items[idx];
    counter.textContent = t('run.counter', { i: idx + 1, n: items.length });
    const secs = Math.ceil(s.remainingMs / 1000);
    status.textContent =
      s.phase === 'countdown'
        ? t('run.countdown', { s: secs })
        : s.phase === 'speaking'
          ? t('run.speaking')
          : s.phase === 'paused'
            ? t('run.paused')
            : s.phase === 'waiting'
              ? t('run.waiting')
              : '';
    status.dataset.phase = s.phase;
    const hide = typing || (app.settings.hideText && !shown);
    word.textContent = item ? (hide ? t('run.hidden') : item.item.text) : '';
    word.lang = item?.lang ?? '';
    pause.textContent = t(s.phase === 'paused' ? 'run.resume' : 'run.pause');
    pause.setAttribute('aria-pressed', s.phase === 'paused' ? 'true' : 'false');
    readDone.hidden = !(s.phase === 'speaking' && session.view.source === 'manual');
    view.querySelector('.run')?.setAttribute('data-source', session.view.source ?? '');
  }

  const session: Session = createSession(
    items,
    app.settings.player,
    () => update(),
    () => {
      saveAnswer();
      current = undefined;
      renderResults(view, title, items, mode, target, typing ? answers : undefined);
    },
  );
  current = session;
  view.replaceChildren(
    h(
      'section',
      { class: 'card run', 'aria-labelledby': 'run-title' },
      h('h1', { id: 'run-title' }, title),
      counter,
      status,
      word,
      typing ? h('div', {}, answer, h('p', { class: 'meta' }, t('run.answerHint'))) : null,
      h(
        'div',
        { class: 'controls toolbar' },
        readDone,
        pause,
        btn('btn-prev', 'run.prev', () => session.dispatch({ type: 'prev' })),
        btn('btn-repeat', 'run.repeat', () => session.dispatch({ type: 'repeat' })),
        btn('btn-next', 'run.next', () => session.dispatch({ type: 'next' })),
        show,
        btn('btn-stop', 'run.stop', () => session.dispatch({ type: 'stop' })),
      ),
    ),
  );
  update();
  session.dispatch({ type: 'start' });
  if (typing) answer.focus();
}

function runCards(view: HTMLElement, title: string, items: SessionItem[], target: string): void {
  const marks: (ItemResult | undefined)[] = items.map(() => undefined);
  let i = 0;
  const draw = () => {
    if (i >= items.length)
      return renderResults(view, title, items, 'cards', target, undefined, marks);
    const it = items[i]!;
    const wordEl = h('p', { class: 'word', id: 'card-word', lang: it.lang }, t('run.hidden'));
    const answerBtns = h(
      'div',
      { class: 'toolbar', hidden: true },
      h(
        'button',
        { type: 'button', id: 'btn-card-right', class: 'primary', onclick: () => next('right') },
        t('cards.right'),
      ),
      h(
        'button',
        { type: 'button', id: 'btn-card-wrong', onclick: () => next('wrong') },
        t('cards.wrong'),
      ),
    );
    const next = (r: ItemResult) => {
      marks[i] = r;
      i++;
      draw();
    };
    view.replaceChildren(
      h(
        'section',
        { class: 'card run', 'aria-labelledby': 'run-title' },
        h('h1', { id: 'run-title' }, title),
        h(
          'p',
          { class: 'counter', id: 'run-counter' },
          t('run.counter', { i: i + 1, n: items.length }),
        ),
        wordEl,
        h(
          'div',
          { class: 'toolbar' },
          h(
            'button',
            { type: 'button', id: 'btn-card-read', onclick: () => void readAloud(it) },
            t('cards.read'),
          ),
          h(
            'button',
            {
              type: 'button',
              id: 'btn-card-reveal',
              onclick: () => {
                wordEl.textContent = it.item.text;
                answerBtns.hidden = false;
              },
            },
            t('cards.reveal'),
          ),
        ),
        answerBtns,
      ),
    );
    void readAloud(it);
  };
  draw();
}

/** Show the learner's answer against the expected text. Built only from checked ops. */
export function renderDiff(ops: readonly Op[]): HTMLElement {
  const out = h('span', { class: 'diff' });
  for (const op of ops) {
    const a = op.a.join('');
    const b = op.b.join('');
    if (op.kind === 'same') out.append(h('span', { class: 'same' }, b));
    else if (op.kind === 'sub')
      out.append(h('span', { class: 'sub', title: t('diff.should', { a }) }, b));
    else if (op.kind === 'ins') out.append(h('span', { class: 'ins', title: t('diff.extra') }, b));
    else if (op.kind === 'del')
      out.append(h('span', { class: 'del', title: t('diff.missing', { a }) }, '⁁'));
    else out.append(h('span', { class: 'swap', title: t('diff.swap') }, b));
  }
  return out;
}

function renderResults(
  view: HTMLElement,
  title: string,
  items: SessionItem[],
  mode: Mode,
  target: string,
  answers?: string[],
  preset?: (ItemResult | undefined)[],
): void {
  const marks: (ItemResult | undefined)[] = preset ? [...preset] : items.map(() => undefined);
  const autos: (MarkResult | undefined)[] = items.map(() => undefined);
  let failed = false;
  if (answers) {
    items.forEach((s, i) => {
      const typed = answers[i] ?? '';
      if (typed.trim() === '') {
        marks[i] = 'blank';
        return;
      }
      try {
        const r = mark(s.item.text, typed, s.item.accept);
        autos[i] = r;
        marks[i] = r.correct ? 'right' : 'wrong';
      } catch (e) {
        if (!(e instanceof CheckerRejected)) throw e;
        failed = true; // leave unmarked: the parent decides
      }
    });
  }
  const score = h('p', { id: 'score', class: 'meta', role: 'status' });
  const updateScore = () => {
    score.textContent = t('results.score', {
      r: marks.filter((m) => m === 'right').length,
      n: items.length,
    });
  };
  const rows = items.map((s, i) => {
    const right = h(
      'button',
      { type: 'button', class: 'mark-right', id: `mark-right-${i}` },
      `✓ ${t('results.right')}`,
    );
    const wrong = h(
      'button',
      { type: 'button', class: 'mark-wrong', id: `mark-wrong-${i}` },
      `✗ ${t('results.wrong')}`,
    );
    const li = h('li', { class: 'result-row', 'data-index': i });
    const sync = () => {
      right.setAttribute('aria-pressed', marks[i] === 'right' ? 'true' : 'false');
      wrong.setAttribute('aria-pressed', marks[i] === 'wrong' ? 'true' : 'false');
      li.dataset.result = marks[i] ?? '';
      updateScore();
    };
    right.addEventListener('click', () => {
      marks[i] = 'right';
      sync();
    });
    wrong.addEventListener('click', () => {
      marks[i] = 'wrong';
      sync();
    });
    const auto = autos[i];
    const details: HTMLElement[] = [];
    if (answers) {
      const typed = answers[i] ?? '';
      if (typed.trim() === '') details.push(h('span', { class: 'bad' }, t('results.blank')));
      else if (auto) {
        details.push(h('span', { class: 'meta' }, `${t('results.yours')}: `), renderDiff(auto.ops));
        if (auto.correct && auto.target >= 0)
          details.push(
            h('span', { class: 'note' }, t('results.accepted', { a: s.item.accept[auto.target]! })),
          );
        if (auto.forgiven.length)
          details.push(
            h(
              'span',
              { class: 'note' },
              t('results.forgiven', {
                rules: auto.forgiven.map((r) => t(`rule.${r}` as StringKey)).join(', '),
              }),
            ),
          );
        if (auto.zeroWidthRemoved)
          details.push(h('span', { class: 'note' }, t('results.zeroWidth')));
      } else details.push(h('span', { class: 'meta' }, `${t('results.yours')}: ${typed}`));
    }
    li.append(
      h('span', { class: 'meta' }, `${i + 1}.`),
      h('span', { class: 'expected', lang: s.lang }, s.item.text),
      ...details,
      h('span', { class: 'toolbar' }, right, wrong),
    );
    sync();
    return li;
  });
  const saveBtn = h(
    'button',
    {
      type: 'button',
      class: 'primary',
      id: 'btn-save-results',
      onclick: async () => {
        saveBtn.disabled = true;
        const ok = await recordResults(
          mode,
          items.map((s, i) => ({
            listId: s.listId,
            itemId: s.item.id,
            result: marks[i] ?? 'blank',
            answer: answers?.[i] ?? '',
          })),
          newId,
        );
        if (ok) showBanner(t('results.saved'));
        else saveBtn.disabled = false;
      },
    },
    t('results.save'),
  );
  view.replaceChildren(
    h(
      'section',
      { class: 'card results', 'aria-labelledby': 'results-title' },
      h('h1', { id: 'results-title' }, `${t('results.title')} · ${title}`),
      score,
      h('p', { class: 'note' }, answers ? t('results.autoNote') : t('results.markHint')),
      failed ? h('p', { class: 'bad' }, t('results.checkerFailed')) : null,
      answers ? h('p', { class: 'meta' }, t('diff.legend')) : null,
      h('ol', { class: 'results', id: 'results-list' }, rows),
      h(
        'div',
        { class: 'toolbar' },
        saveBtn,
        h(
          'button',
          {
            type: 'button',
            id: 'print-score',
            onclick: () => {
              fillScore(
                title,
                items.map((s, i) => ({
                  text: s.item.text,
                  lang: s.lang,
                  result: marks[i],
                  ...(answers ? { answer: answers[i] ?? '' } : {}),
                })),
              );
              printNow();
            },
          },
          t('print.scoreBtn'),
        ),
        h(
          'a',
          { class: 'file-btn', id: 'btn-again', href: `#/practice/${target}?again=${Date.now()}` },
          t('results.again'),
        ),
      ),
    ),
  );
  updateScore();
}
