#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Regenerate docs/screenshot.png (typing-mode results for the English sample list)
// against a running server, using a fake voice so no audio device is needed.
// Usage: npm start (in another terminal), then
//   PW_CHROMIUM_PATH=/usr/bin/google-chrome npm run screenshot [-- http://127.0.0.1:4887]
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:4887';
const executablePath = process.env.PW_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
});
await page.addInitScript(() => {
  const voices = [{ name: 'Demo voice', lang: 'en-GB', localService: true, voiceURI: 'demo' }];
  class U {
    constructor(text) {
      this.text = text;
      this.onend = null;
      this.onerror = null;
    }
  }
  const synth = {
    getVoices: () => voices,
    speak: (u) => setTimeout(() => u.onend?.(), 30),
    cancel() {},
    addEventListener() {},
  };
  Object.defineProperty(globalThis, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: U, configurable: true });
});
await page.goto(`${base}/#/`);
await page.locator('body[data-ready="true"]').waitFor();
await page.locator('#set-lang').selectOption('en');
await page.locator('#add-samples').click();
await page.locator('#lists li').first().locator('a').nth(1).click();
await page.locator('#mode-typing').check();
for (const [id, v] of [
  ['#opt-repeats', '1'],
  ['#opt-gap', '0'],
  ['#opt-itemgap', '60'],
  ['#opt-countdown', '0'],
])
  await page.locator(id).fill(v);
await page.locator('#btn-start').click();
const answers = ['kettle', 'spon', 'widnow', 'Color', 'recieve', 'necessary'];
for (const a of answers) {
  await page.locator('#answer').fill(a);
  await page.locator('#answer').press('Enter');
}
await page.locator('#btn-stop').click();
await page.locator('#results-list li').first().waitFor();
const box = await page.locator('section.results').boundingBox();
await page.setViewportSize({ width: 1280, height: Math.ceil(box.y + box.height + 24) });
await page.screenshot({ path: 'docs/screenshot.png', fullPage: false });
await browser.close();
console.info('wrote docs/screenshot.png');
