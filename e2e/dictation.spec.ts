// SPDX-License-Identifier: AGPL-3.0-or-later
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { fakeSpeech, fastSettings, makeList, open, spoken, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  // Start every test with empty storage (but keep it across reloads inside a test).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      indexedDB.deleteDatabase('dictalark');
    }
  });
});

async function english(page: Page) {
  await page.locator('#set-lang').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}

test('Traditional Chinese list → paper dictation → self-mark → wrong word comes back for review', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await fakeSpeech(page);
  await open(page);
  await makeList(page, '中文默書 第一課', ['默書', '雲雀', '羣']);
  await expect(page.locator('#items-table tbody tr')).toHaveCount(3);
  await expect(page.locator('#item-text-2')).toHaveValue('羣');
  await expect(page.locator('#list-lang')).toHaveValue('yue-HK');
  await expect(page.locator('#voice-status')).toHaveAttribute('data-quality', 'exact');

  // The words survive a reload (IndexedDB).
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#item-text-1')).toHaveValue('雲雀');

  await page.locator('#practise-link').click();
  await page.locator('#mode-paper').check();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#results-list li')).toHaveCount(3, { timeout: 15_000 });
  const said = await spoken(page);
  expect(said.map((s) => s.text)).toEqual(['默書', '雲雀', '羣']);
  expect(new Set(said.map((s) => s.voice))).toEqual(new Set(['Test Cantonese']));
  // 羣 is not silently turned into 群 anywhere.
  await expect(page.locator('#results-list li').nth(2).locator('.expected')).toHaveText('羣');

  await page.locator('#mark-right-0').click();
  await page.locator('#mark-right-1').click();
  await page.locator('#mark-wrong-2').click();
  await expect(page.locator('#score')).toContainText('2');
  await page.locator('#btn-save-results').click();
  await expect(page.locator('#banner')).toContainText('已儲存');
  await expect(page.locator('#nav-review')).toContainText('1');
  await page.locator('#nav-review').click();
  await expect(page.locator('#review-list li')).toHaveCount(1);
  await expect(page.locator('#review-list li strong')).toHaveText('羣');

  expect(w.external).toEqual([]);
  expect(w.nonGet).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('typing mode marks English answers and shows a swapped pair', async ({ page, baseURL }) => {
  const w = watch(page, baseURL!);
  await fakeSpeech(page);
  await open(page);
  await english(page);
  await makeList(page, 'Spelling week 1', ['receive', 'colour', 'necessary']);
  await expect(page.locator('#list-lang')).toHaveValue('en-GB');
  await page.locator('#item-accept-1').fill('color');
  await page.locator('#item-accept-1').blur();
  await page.locator('#practise-link').click();
  await page.locator('#mode-typing').check();
  await fastSettings(page);
  await page.locator('#opt-itemgap').fill('60');
  await page.locator('#btn-start').click();
  const answer = page.locator('#answer');
  await expect(answer).toBeFocused();
  await expect(page.locator('#run-word')).toHaveText('(hidden)');
  await answer.pressSequentially('recieve');
  await answer.press('Enter');
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 3');
  await answer.pressSequentially('Color');
  await answer.press('Enter');
  await expect(page.locator('#run-counter')).toHaveText('Item 3 of 3');
  await answer.press('Enter');

  const rows = page.locator('#results-list li');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-result', 'wrong');
  await expect(rows.nth(0).locator('.diff .swap')).toHaveText('ie');
  await expect(rows.nth(1)).toHaveAttribute('data-result', 'right');
  await expect(rows.nth(1)).toContainText('Accepted answer: color');
  await expect(rows.nth(1)).toContainText('capital letters');
  await expect(rows.nth(2)).toHaveAttribute('data-result', 'blank');
  await expect(page.locator('#score')).toHaveText('1 of 3 right');
  await expect(page.getByText('Automatic marking is only a guide; you can change')).toBeVisible();
  // The parent can overrule the automatic mark.
  await page.locator('#mark-right-0').click();
  await expect(page.locator('#score')).toHaveText('2 of 3 right');
  await page.locator('#btn-save-results').click();
  await expect(page.locator('#banner')).toContainText('Saved');
  await expect(page.locator('#nav-review')).toContainText('(1)');
  expect(w.external).toEqual([]);
  expect(w.nonGet).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('typing Traditional Chinese: a wrong character is shown as a substitution', async ({
  page,
}) => {
  await fakeSpeech(page);
  await open(page);
  await makeList(page, '詞語', ['默書雲雀']);
  await page.locator('#practise-link').click();
  await page.locator('#mode-typing').check();
  await fastSettings(page);
  await page.locator('#opt-itemgap').fill('60');
  await page.locator('#btn-start').click();
  await page.locator('#answer').click();
  await page.keyboard.insertText('默書雲雀');
  await page.locator('#answer').press('Enter');
  await expect(page.locator('#results-list li').first()).toHaveAttribute('data-result', 'right');
  await page.locator('#btn-again').click();
  await page.locator('#mode-typing').check();
  await fastSettings(page);
  await page.locator('#opt-itemgap').fill('60');
  await page.locator('#btn-start').click();
  await page.locator('#answer').click();
  await page.keyboard.insertText('默書雲崔');
  await page.locator('#answer').press('Enter');
  const row = page.locator('#results-list li').first();
  await expect(row).toHaveAttribute('data-result', 'wrong');
  await expect(row.locator('.diff .sub')).toHaveText('崔');
  await expect(row.locator('.diff .same')).toHaveCount(3);
});

test('without a voice or recording, the parent reads aloud and presses a button', async ({
  page,
}) => {
  await fakeSpeech(page, []);
  await open(page);
  await english(page);
  await makeList(page, 'No voice', ['apple', 'pear']);
  await expect(page.locator('#voice-status')).toHaveAttribute('data-quality', 'none');
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#btn-readdone')).toBeVisible();
  await expect(page.locator('#run-counter')).toHaveText('Item 1 of 2');
  await page.locator('#btn-readdone').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 2');
  await page.locator('#btn-readdone').click();
  await expect(page.locator('#results-list li')).toHaveCount(2);
  expect(await spoken(page)).toEqual([]);
});

test('online-only voices are not used unless allowed', async ({ page }) => {
  await fakeSpeech(page, [{ name: 'Cloud Cantonese', lang: 'yue-HK', localService: false }]);
  await open(page);
  await makeList(page, '粵語', ['雲雀']);
  await expect(page.locator('#voice-status')).toHaveAttribute('data-quality', 'none');
  await expect(page.locator('#voice-status')).toContainText('網上語音');
  await page.locator('#set-remote').check();
  await expect(page.locator('#voice-status')).toHaveAttribute('data-quality', 'exact');
});

test('Mandarin never silently uses a Cantonese voice', async ({ page }) => {
  await fakeSpeech(page, [{ name: 'Test Cantonese', lang: 'zh-HK', localService: true }]);
  await open(page);
  await makeList(page, '普通話', ['你好']);
  await page.locator('#list-subject').selectOption('mandarin');
  await expect(page.locator('#list-lang')).toHaveValue('zh-TW');
  await expect(page.locator('#voice-status')).toHaveAttribute('data-quality', 'mismatch');
});

test('controls: pause, resume, repeat and finish early', async ({ page }) => {
  await fakeSpeech(page);
  await open(page);
  await english(page);
  await makeList(page, 'Controls', ['one', 'two', 'three']);
  await page.locator('#practise-link').click();
  await page.locator('#opt-repeats').fill('1');
  await page.locator('#opt-gap').fill('0');
  await page.locator('#opt-itemgap').fill('30');
  await page.locator('#opt-countdown').fill('0');
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'waiting');
  await page.locator('#btn-pause').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'paused');
  await page.locator('#btn-pause').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'waiting');
  await page.locator('#btn-repeat').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'waiting');
  await page.locator('#btn-next').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 3');
  await expect
    .poll(async () => (await spoken(page)).map((s) => s.text))
    .toEqual(['one', 'one', 'two']);
  await page.locator('#btn-stop').click();
  await expect(page.locator('#results-list li')).toHaveCount(3);
});

test('pausing or skipping during a reading never skips an extra item', async ({ page }) => {
  // Slow voice: every reading takes 1.5 s, so the buttons are pressed mid-reading.
  await fakeSpeech(page, undefined, 1500);
  await open(page);
  await english(page);
  await makeList(page, 'Slow', ['alpha', 'bravo', 'charlie']);
  await page.locator('#practise-link').click();
  await page.locator('#opt-repeats').fill('1');
  await page.locator('#opt-gap').fill('0');
  await page.locator('#opt-itemgap').fill('30');
  await page.locator('#opt-countdown').fill('0');
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.locator('#btn-pause').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'paused');
  await page.waitForTimeout(300);
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'paused');
  await page.locator('#btn-pause').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.locator('#btn-next').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 3');
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.waitForTimeout(400);
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 3');
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'waiting', {
    timeout: 5000,
  });
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 3');
  expect((await spoken(page)).map((s) => s.text)).toEqual(['alpha', 'alpha', 'bravo']);
});

test('flash cards: read, reveal, mark yourself', async ({ page }) => {
  await fakeSpeech(page);
  await open(page);
  await english(page);
  await makeList(page, 'Cards', ['kite', 'lark']);
  await page.locator('#practise-link').click();
  await page.locator('#mode-cards').check();
  await page.locator('#btn-start').click();
  await expect(page.locator('#card-word')).toHaveText('(hidden)');
  await page.locator('#btn-card-reveal').click();
  await expect(page.locator('#card-word')).toHaveText('kite');
  await page.locator('#btn-card-right').click();
  await page.locator('#btn-card-reveal').click();
  await page.locator('#btn-card-wrong').click();
  await expect(page.locator('#results-list li').nth(0)).toHaveAttribute('data-result', 'right');
  await expect(page.locator('#results-list li').nth(1)).toHaveAttribute('data-result', 'wrong');
});

test('import CSV, back up to JSON, wipe, restore', async ({ page, baseURL }) => {
  const w = watch(page, baseURL!);
  await open(page);
  await english(page);
  const csv =
    '\ufefftext,accept,note\nreceive,,i before e\ncolour,color,\n,,note without a word\n=necessary,,\n';
  await page.locator('#import-file').setInputFiles({
    name: 'week2.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(page.locator('#banner')).toContainText('Imported 3 words into “week2”');
  await expect(page.locator('#banner')).toContainText('Skipped empty rows: 4');
  await page.locator('#lists li a', { hasText: 'Edit' }).click();
  await expect(page.locator('#item-text-2')).toHaveValue('=necessary');
  await expect(page.locator('#item-accept-1')).toHaveValue('color');
  await page.locator('a[href="#/"]').first().click();

  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^dictalark-\d{4}-\d{2}-\d{2}\.json$/);
  const json = await (await dl.createReadStream()).toArray();
  const text = Buffer.concat(json).toString('utf8');
  expect(JSON.parse(text).format).toBe('dictalark');

  page.once('dialog', (d) => void d.accept());
  await page.locator('#wipe').click();
  await expect(page.locator('#home-empty')).toBeVisible();
  // Wiping also resets settings (language back to Traditional Chinese).
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-HK');
  await page.locator('#import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  });
  await expect(page.locator('#lists li')).toHaveCount(1);
  await expect(page.locator('#lists li strong')).toHaveText('week2');
  // Importing the same backup again keeps both (new ids, nothing overwritten).
  await page.locator('#import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  });
  await expect(page.locator('#lists li')).toHaveCount(2);
  // A hostile file is refused with a message, not a crash.
  await page.locator('#import-file').setInputFiles({
    name: 'evil.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"dictalark","schema":1,"__proto__":{"x":1},"lists":[]}', 'utf8'),
  });
  await expect(page.locator('#banner')).toHaveClass(/error/);
  await expect(page.locator('#lists li')).toHaveCount(2);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('words are shown as text, never as markup', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  await fakeSpeech(page);
  await open(page);
  await makeList(page, '<img src=x onerror=alert(1)>', ['<b>bold</b>']);
  await expect(page.locator('#list-title')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('b', { hasText: 'bold' })).toHaveCount(0);
  expect(dialogs).toBe(0);
});

test('works offline after the first visit', async ({ page, context, baseURL }) => {
  const w = watch(page, baseURL!);
  await fakeSpeech(page);
  await open(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await makeList(page, 'Offline', ['cloud']);
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#results-list li')).toHaveCount(1);
  await context.setOffline(false);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('footer links to the exact source version', async ({ page }) => {
  await open(page);
  const version = (await page.locator('#app-version').textContent())!.replace(/^v/, '');
  await expect(page.locator('#source-link')).toHaveAttribute(
    'href',
    `https://github.com/Kinfxhk/dictalark/tree/v${version}`,
  );
});

for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility problems (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await fakeSpeech(page);
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const check = async () => {
      const r = await new AxeBuilder({ page }).analyze();
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(
        bad.map((v) => `${v.id}: ${v.nodes.length} × ${v.nodes[0]?.target.join(' ')}`),
      ).toEqual([]);
    };
    await check();
    await makeList(page, 'A11y', ['receive', 'colour']);
    await check();
    await page.locator('#practise-link').click();
    await check();
    await page.locator('#mode-typing').check();
    await fastSettings(page);
    await page.locator('#opt-itemgap').fill('60');
    await page.locator('#btn-start').click();
    await check();
    await page.locator('#answer').pressSequentially('recieve');
    await page.locator('#answer').press('Enter');
    await page.locator('#answer').press('Enter');
    await expect(page.locator('#results-list li')).toHaveCount(2);
    await check();
  });
}
