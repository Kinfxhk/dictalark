// SPDX-License-Identifier: AGPL-3.0-or-later
// v0.2: "read as" text, start from item N / continue, stop mid-reading, passage mode,
// punctuation names, chosen voices, share links, storage status and backup reminder.
import { expect, test, type Page } from '@playwright/test';
import { fakeSpeech, fastSettings, makeList, open, spoken, watch } from './helpers';

test.beforeEach(async ({ page }) => {
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

test('"read as" changes only what the voice says; marking uses the word', async ({ page }) => {
  await fakeSpeech(page);
  await open(page);
  await english(page);
  await makeList(page, 'Holiday', ['放假', 'colour']);
  await page.locator('#item-say-0').click();
  await page.keyboard.insertText('放價');
  await page.locator('#item-say-0').blur();
  await expect(page.locator('#banner')).toContainText('Saved');
  // Per-item language: the English word in this list is read with the English voice.
  await page.locator('#list-subject').selectOption('chinese');
  await page.locator('#item-lang-1').selectOption('en-GB');
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#item-say-0')).toHaveValue('放價');
  await expect(page.locator('#item-lang-1')).toHaveValue('en-GB');
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#mode-typing').check();
  await page.locator('#btn-start').click();
  await page.locator('#answer').waitFor();
  await page.keyboard.insertText('放假');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('colour');
  await page.keyboard.press('Enter');
  await expect(page.locator('#score')).toHaveText('2 of 2 right');
  const said = await spoken(page);
  expect(said.map((s) => s.text)).toEqual(['放價', 'colour']);
  expect(said.map((s) => s.voice)).toEqual(['Test Cantonese', 'Test English']);
});

test('start from item N; stop during a reading really stops; continue from there', async ({
  page,
}) => {
  await fakeSpeech(page, undefined, 1500);
  await open(page);
  await english(page);
  await makeList(page, 'Resume', ['alpha', 'bravo', 'charlie', 'delta']);
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#opt-itemgap').fill('30');
  await page.locator('#opt-from').fill('2');
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 4');
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.locator('#btn-next').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 3 of 4');
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.locator('#btn-stop').click();
  await expect(page.locator('#results-list li')).toHaveCount(3);
  await page.waitForTimeout(2000);
  // Nothing is read after Finish, even though the slow voice was mid-word.
  expect((await spoken(page)).map((s) => s.text)).toEqual(['bravo', 'charlie']);
  await expect(page.locator('#results-list li').first()).toContainText('2.');
  await expect(page.locator('#btn-continue')).toHaveText('Continue from item 3');
  await page.locator('#btn-continue').click();
  await expect(page.locator('#opt-from')).toHaveValue('3');
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 3 of 4');
  await page.locator('#btn-stop').click();
  await expect(page.locator('#results-list li')).toHaveCount(2);
});

test('shuffled continue keeps the same order (same shuffle number)', async ({ page }) => {
  await fakeSpeech(page, undefined, 1500);
  await open(page);
  await english(page);
  await makeList(page, 'Shuffled', ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']);
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#opt-shuffle').check();
  await page.locator('#opt-seed').fill('4242');
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-status')).toHaveAttribute('data-phase', 'speaking');
  await page.locator('#btn-next').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 6');
  await page.locator('#btn-stop').click();
  const first = (await spoken(page)).map((s) => s.text);
  await page.locator('#btn-continue').click();
  await expect(page.locator('#opt-seed')).toHaveValue('4242');
  await expect(page.locator('#opt-shuffle')).toBeChecked();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#run-counter')).toHaveText('Item 2 of 6');
  await expect.poll(async () => (await spoken(page)).length).toBe(3);
  expect((await spoken(page))[2]!.text).toBe(first[1]);
});

test('passage mode reads each part; custom punctuation names are used', async ({ page }) => {
  await fakeSpeech(page);
  await open(page);
  await english(page);
  await makeList(page, 'Passage', ['今天天氣很好，我們去公園玩！']);
  await page.locator('#list-subject').selectOption('chinese');
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#opt-passage').check();
  await page.locator('#opt-punct').check();
  await page.locator('#punct-details summary').click();
  await page.locator('#opt-punctnames').fill('！ = 感歎號');
  await page.locator('#btn-start').click();
  await page.locator('#btn-show').waitFor();
  await expect(page.locator('#results-list li')).toHaveCount(1, { timeout: 10_000 });
  expect((await spoken(page)).map((s) => s.text)).toEqual([
    '今天天氣很好 逗號',
    '我們去公園玩 感歎號',
  ]);
  // A bad entry is refused with a message before starting.
  await page.locator('#btn-again').click();
  await page.locator('#punct-details summary').click();
  await page.locator('#opt-punctnames').fill('nonsense');
  await page.locator('#btn-start').click();
  await expect(page.locator('#banner')).toHaveClass(/error/);
  await expect(page.locator('#practice-form')).toBeVisible();
});

test('voices page: try a voice and choose it for its language', async ({ page }) => {
  await fakeSpeech(page, [
    { name: 'Voice One', lang: 'en-GB', localService: true },
    { name: 'Voice Two', lang: 'en-GB', localService: true },
    { name: 'Cloud Voice', lang: 'en-GB', localService: false },
  ]);
  await open(page);
  await english(page);
  await page.locator('#nav-voices').click();
  await expect(page.locator('#voices-table tbody tr')).toHaveCount(3);
  const cloud = page.locator('tr[data-voice="Cloud Voice"] button').first();
  await expect(cloud).toBeDisabled();
  await page.locator('tr[data-voice="Voice Two"] button').first().click();
  await expect.poll(async () => (await spoken(page)).at(-1)?.voice).toBe('Voice Two');
  await page.locator('tr[data-voice="Voice Two"] button').nth(1).click();
  await expect(page.locator('tr[data-voice="Voice Two"]')).toHaveAttribute('data-chosen', 'true');
  await page.locator('#nav-home').click();
  await makeList(page, 'Voices', ['lark']);
  await expect(page.locator('#voice-status')).toContainText('Voice Two');
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#results-list li')).toHaveCount(1, { timeout: 10_000 });
  expect((await spoken(page)).at(-1)).toMatchObject({ text: 'lark', voice: 'Voice Two' });
});

test('share link: the list travels in the link, is previewed and added only on request', async ({
  page,
  context,
  baseURL,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const w = watch(page, baseURL!);
  await open(page);
  await english(page);
  await makeList(page, 'Shared 默書', ['放假', 'colour']);
  await page.locator('#item-say-0').click();
  await page.keyboard.insertText('放價');
  await page.locator('#item-say-0').blur();
  await expect(page.locator('#banner')).toContainText('Saved');
  await page.locator('#share-btn').click();
  const url = await page.locator('#share-url').inputValue();
  expect(url).toMatch(/#\/share\/[A-Za-z0-9_-]+$/);
  // Open the link in a fresh browser profile: nothing is stored until "Add".
  const other = await (await context.browser()!.newContext()).newPage();
  const w2 = watch(other, baseURL!);
  await other.goto(url);
  await other.locator('body[data-ready="true"]').waitFor();
  await expect(other.locator('#share-name')).toHaveText('Shared 默書');
  await expect(other.locator('#share-items li')).toHaveText(['放假', 'colour']);
  await other.locator('#share-add').click();
  await expect(other.locator('#item-say-0')).toHaveValue('放價');
  await expect(other.locator('#list-title')).toHaveText('Shared 默書');
  // A tampered link shows an error, not a crash.
  await other.goto(url.replace(/#\/share\/.*/, '#/share/AAAA$$'));
  await other.goto(url.replace(/#\/share\/.*/, '#/share/eyJ2Ijo5fQ'));
  await expect(other.locator('#share-error')).toBeVisible();
  for (const x of [w, w2]) {
    expect(x.external).toEqual([]);
    expect(x.nonGet).toEqual([]);
    expect(x.errors).toEqual([]);
  }
});

test('storage status is shown; backup reminder appears, can be dismissed, and clears after a backup', async ({
  page,
}) => {
  await open(page);
  await english(page);
  await makeList(page, 'Remind', ['one']);
  await page.locator('a[href="#/"]').first().click();
  await expect(page.locator('#persist-status')).toHaveAttribute(
    'data-status',
    /^(persisted|not-persisted|unsupported)$/,
  );
  await expect(page.locator('#persist-status')).toContainText('Storage:');
  await expect(page.locator('#reminder')).toBeHidden();
  // Pretend 25 changes have been made since the last backup.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const r = indexedDB.open('dictalark');
        r.onsuccess = () => {
          const t = r.result.transaction('kv', 'readwrite');
          const kv = t.objectStore('kv');
          const g = kv.get('settings');
          g.onsuccess = () => {
            const s = g.result as Record<string, unknown>;
            s.backup = {
              lastAt: '',
              changes: 25,
              firstChangeAt: new Date().toISOString(),
              snoozedAt: '',
              snoozedChanges: 0,
            };
            kv.put(s, 'settings');
          };
          t.oncomplete = () => {
            r.result.close();
            resolve();
          };
          t.onerror = () => reject(t.error);
        };
      }),
  );
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#reminder')).toBeVisible();
  await expect(page.locator('#reminder')).toContainText('25 changes');
  await page.locator('#reminder-later').click();
  await expect(page.locator('#reminder')).toBeHidden();
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#reminder')).toBeHidden();
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-all').click(),
  ]);
  expect(dl.suggestedFilename()).toMatch(/^dictalark-backup-/);
  await expect(page.locator('#last-backup')).toBeVisible();
  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#last-backup')).toContainText('Last backup from this device');
});

test('a v0.1 backup file (schema 1) still imports', async ({ page }) => {
  await open(page);
  await english(page);
  const v01 = {
    format: 'dictalark',
    schema: 1,
    exportedAt: '2026-10-08T03:00:00Z',
    lists: [
      {
        id: 'old1',
        name: 'From v0.1',
        subject: 'english',
        lang: 'en-GB',
        items: [{ id: 'x1', text: 'receive', accept: [], note: '' }],
        createdAt: '2026-10-08T03:00:00Z',
        updatedAt: '2026-10-08T03:00:00Z',
      },
    ],
    attempts: [],
    srs: {},
  };
  await page.locator('#import-file').setInputFiles({
    name: 'dictalark-2026-10-08.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(v01), 'utf8'),
  });
  await expect(page.locator('#lists li strong')).toHaveText('From v0.1');
});
