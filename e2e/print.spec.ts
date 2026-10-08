// SPDX-License-Identifier: AGPL-3.0-or-later
// Sample lists and printing (answer sheet, answer key, score sheet → PDF).
import { expect, test, type Page } from '@playwright/test';
import { fakeSpeech, fastSettings, open, watch } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      indexedDB.deleteDatabase('dictalark');
    }
    // Count print requests instead of opening the print dialog.
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints++;
    };
  });
});

const prints = (page: Page) =>
  page.evaluate(() => (window as unknown as { __prints: number }).__prints);

async function pdfPages(page: Page): Promise<number> {
  const pdf = await page.pdf({ format: 'A4' });
  const text = pdf.toString('latin1');
  expect(text.startsWith('%PDF-')).toBe(true);
  return (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

test('sample lists are added once and are small, self-written lists', async ({ page, baseURL }) => {
  const w = watch(page, baseURL!);
  await open(page);
  await page.locator('#set-lang').selectOption('en');
  await page.locator('#add-samples').click();
  await expect(page.locator('#banner')).toContainText('Added 3 sample list(s).');
  await expect(page.locator('#lists li')).toHaveCount(3);
  await page.locator('#add-samples').click();
  await expect(page.locator('#banner')).toContainText('already here');
  await expect(page.locator('#lists li')).toHaveCount(3);
  await expect(page.locator('#lists li strong')).toHaveText([
    'Sample: around the house (English)',
    '示範：日常詞語（中文・粵語）',
    '示範：普通話日常詞語',
  ]);
  expect(w.external).toEqual([]);
  expect(w.errors).toEqual([]);
});

test('answer sheet and answer key print on their own, as PDF', async ({ page }) => {
  await open(page);
  await page.locator('#set-lang').selectOption('en');
  await page.locator('#add-samples').click();
  await page.locator('#lists li').first().locator('a', { hasText: 'Edit' }).click();
  await expect(page.locator('#items-table tbody tr')).toHaveCount(12);

  await page.locator('#print-sheet').click();
  expect(await prints(page)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#print-area')).toBeVisible();
  await expect(page.locator('main#view')).toBeHidden();
  await expect(page.locator('header.top')).toBeHidden();
  await expect(page.locator('.print-doc[data-kind="sheet"] li')).toHaveCount(12);
  // The answer sheet must not give the answers away.
  await expect(page.locator('#print-area')).not.toContainText('kettle');
  await expect(page.locator('#print-area')).toContainText('Name');
  expect(await pdfPages(page)).toBeGreaterThanOrEqual(1);
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('#print-area')).toBeHidden();

  await page.locator('#print-key').click();
  expect(await prints(page)).toBe(2);
  await page.emulateMedia({ media: 'print' });
  const key = page.locator('.print-doc[data-kind="key"] li');
  await expect(key).toHaveCount(12);
  await expect(key.nth(0)).toHaveText('kettle');
  await expect(key.nth(3)).toContainText('colour');
  await expect(key.nth(3)).toContainText('(color)');
  expect(await pdfPages(page)).toBeGreaterThanOrEqual(1);
});

test('score sheet after a dictation', async ({ page }) => {
  await fakeSpeech(page);
  await open(page);
  await page.locator('#add-samples').click();
  await page.locator('#lists li').nth(1).locator('a').nth(1).click();
  await page.locator('#mode-paper').check();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#results-list li')).toHaveCount(10, { timeout: 20_000 });
  await page.locator('#mark-right-0').click();
  await page.locator('#mark-wrong-1').click();
  await page.locator('#print-score').click();
  expect(await prints(page)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  const rows = page.locator('.print-doc[data-kind="score"] tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(rows.nth(0)).toContainText('默書');
  await expect(rows.nth(0)).toContainText('✓');
  await expect(rows.nth(1)).toContainText('✗');
  await expect(page.locator('.print-doc[data-kind="score"]')).toContainText('10 項中答對 1 項');
  expect(await pdfPages(page)).toBeGreaterThanOrEqual(1);
});
