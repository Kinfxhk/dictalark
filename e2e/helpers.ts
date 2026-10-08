// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Page } from '@playwright/test';

/** Collect requests to other origins, non-GET requests, console errors and page errors. */
export function watch(
  page: Page,
  baseURL: string,
): { external: string[]; nonGet: string[]; errors: string[] } {
  const external: string[] = [];
  const nonGet: string[] = [];
  const errors: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith(baseURL) && !url.startsWith('data:') && !url.startsWith('blob:'))
      external.push(url);
    if (req.method() !== 'GET') nonGet.push(`${req.method()} ${url}`);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return { external, nonGet, errors };
}

export async function open(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.locator('body[data-ready="true"]').waitFor();
}

export interface FakeVoice {
  name: string;
  lang: string;
  localService: boolean;
}

export const DEFAULT_VOICES: FakeVoice[] = [
  { name: 'Test English', lang: 'en-GB', localService: true },
  { name: 'Test Cantonese', lang: 'zh-HK', localService: true },
];

/**
 * Replace the browser's speech synthesis with a fake that "speaks" instantly and records
 * what it was asked to say in `window.__spoken` (text, lang, voice name).
 */
export async function fakeSpeech(
  page: Page,
  voices: FakeVoice[] = DEFAULT_VOICES,
  speakMs = 60,
): Promise<void> {
  await page.addInitScript(
    ({ list, ms }: { list: FakeVoice[]; ms: number }) => {
      const w = window as unknown as {
        __spoken: { text: string; lang: string; voice: string | null }[];
      };
      w.__spoken = [];
      const voiceObjs = list.map((v) => ({ ...v, voiceURI: v.name, default: false }));
      class FakeUtterance {
        text: string;
        lang = '';
        rate = 1;
        voice: { name: string } | null = null;
        onend: (() => void) | null = null;
        onerror: ((e: { error?: string }) => void) | null = null;
        constructor(text: string) {
          this.text = text;
        }
      }
      let pending: number | undefined;
      const synth = {
        getVoices: () => voiceObjs,
        speak(u: FakeUtterance) {
          w.__spoken.push({ text: u.text, lang: u.lang, voice: u.voice?.name ?? null });
          pending = window.setTimeout(() => u.onend?.(), ms);
        },
        cancel() {
          window.clearTimeout(pending);
        },
        addEventListener() {},
        removeEventListener() {},
      };
      Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
      Object.defineProperty(window, 'SpeechSynthesisUtterance', {
        value: FakeUtterance,
        configurable: true,
      });
    },
    { list: voices, ms: speakMs },
  );
}

export async function spoken(
  page: Page,
): Promise<{ text: string; lang: string; voice: string | null }[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __spoken: { text: string; lang: string; voice: string | null }[] })
        .__spoken,
  );
}

/** Make a list from the home screen and add words (typed with insertText, as an IME would). */
export async function makeList(page: Page, name: string, words: string[]): Promise<void> {
  await page.locator('#new-list').click();
  await page.locator('#list-name').waitFor();
  await page.locator('#list-name').fill(name);
  await page.locator('#list-name').blur();
  await page.locator('#list-title', { hasText: name }).waitFor();
  const box = page.locator('#add-words');
  await box.click();
  for (const [i, w] of words.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.insertText(w);
  }
  await page.locator('#add-btn').click();
}

/** Fast player settings (no countdown, no gaps, one reading). */
export async function fastSettings(page: Page): Promise<void> {
  for (const [id, v] of [
    ['#opt-repeats', '1'],
    ['#opt-gap', '0'],
    ['#opt-itemgap', '0'],
    ['#opt-countdown', '0'],
  ] as const)
    await page.locator(id).fill(v);
}
