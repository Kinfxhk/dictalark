// SPDX-License-Identifier: AGPL-3.0-or-later
// Class lists by file: teacher pack → pupil opens (preview, add, later update) → pupil
// results file → teacher summary. Two separate browser profiles, files only.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Download, type Page } from '@playwright/test';
import { fakeSpeech, fastSettings, makeList, open, watch } from './helpers';

async function english(page: Page) {
  await page.locator('#set-lang').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
}
const text = async (d: Download) => readFileSync((await d.path())!, 'utf8');
const save = async (page: Page, id: string) => {
  const [d] = await Promise.all([page.waitForEvent('download'), page.locator(id).click()]);
  return { name: d.suggestedFilename(), body: await text(d) };
};
const file = (name: string, body: string) => ({
  name,
  mimeType: 'application/json',
  buffer: Buffer.from(body, 'utf8'),
});

test('class pack, pupil update, results file and teacher summary', async ({
  page,
  browser,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await open(page);
  await english(page);
  await makeList(page, 'Week 5 默書', ['放假', 'colour']);
  await expect(page.locator('#banner')).toContainText('Saved');
  await page.locator('#nav-class').click();
  await expect(page.locator('#class-title')).toHaveText('Class lists by file');
  await page.locator('#send-list-0').check();
  await page.locator('#pack-title').fill('P.3 Week 5');
  await page.locator('#pack-note').fill('Test on Friday');
  const pack1 = await save(page, '#pack-save');
  expect(pack1.name).toMatch(/\.json$/);
  expect(JSON.parse(pack1.body)).toMatchObject({
    format: 'dictalark-class-pack',
    title: 'P.3 Week 5',
  });

  // Pupil, in a separate browser profile.
  const pupilCtx = await browser.newContext();
  const pupil = await pupilCtx.newPage();
  const w2 = watch(pupil, baseURL!);
  await fakeSpeech(pupil);
  await open(pupil, '/#/class');
  await english(pupil);
  await pupil.locator('#pack-file').setInputFiles(file('pack.json', pack1.body));
  await expect(pupil.locator('#pack-preview-title')).toHaveText('P.3 Week 5');
  await expect(pupil.locator('#pack-preview-note')).toHaveText('Test on Friday');
  await expect(pupil.locator('#pack-added')).toContainText('Week 5 默書');
  await pupil.locator('#pack-apply').click();
  await expect(pupil.locator('#banner')).toContainText('Added 1 and updated 0');
  // Teacher adds a word and sends the pack again: the pupil's list is updated, not doubled.
  await page.locator('#nav-home').click();
  await page.locator('#lists li').first().locator('a', { hasText: 'Edit' }).click();
  await page.locator('#add-words').click();
  await page.keyboard.insertText('雲雀');
  await page.locator('#add-btn').click();
  await page.locator('#nav-class').click();
  await page.locator('#send-list-0').check();
  await page.locator('#pack-title').fill('P.3 Week 5 (fixed)');
  const pack2 = await save(page, '#pack-save');
  await pupil.locator('#pack-file').setInputFiles(file('pack2.json', pack2.body));
  await expect(pupil.locator('#pack-updated')).toContainText('Week 5 默書');
  await expect(pupil.locator('#pack-added')).toContainText('—');
  await pupil.locator('#pack-apply').click();
  await expect(pupil.locator('#banner')).toContainText('Added 0 and updated 1');
  await pupil.locator('#nav-home').click();
  await expect(pupil.locator('#lists li')).toHaveCount(1);
  await expect(pupil.locator('#lists li').first()).toContainText('3 items');

  // A tampered pack is refused with a message.
  await pupil.locator('#nav-class').click();
  await pupil
    .locator('#pack-file')
    .setInputFiles(file('bad.json', '{"format":"dictalark-class-pack","schema":9}'));
  await expect(pupil.locator('#banner')).toContainText('newer Dictalark');

  // The pupil practises once (typing), then saves a results file.
  await pupil.locator('#nav-home').click();
  await pupil.locator('#lists li').first().getByRole('link', { name: 'Practise' }).click();
  await pupil.locator('#mode-typing').check();
  await fastSettings(pupil);
  await pupil.locator('#opt-itemgap').fill('60');
  await pupil.locator('#btn-start').click();
  for (const [n, answer] of ['放假', 'color', ''].entries()) {
    await expect(pupil.locator('#run-counter')).toHaveText(`Item ${n + 1} of 3`);
    await pupil.locator('#answer').click();
    if (answer) await pupil.keyboard.insertText(answer);
    await pupil.locator('#answer').press('Enter');
  }
  await expect(pupil.locator('#results-list li')).toHaveCount(3, { timeout: 15_000 });
  await pupil.locator('#btn-save-results').click();
  await expect(pupil.locator('#banner')).toContainText('Saved');
  await pupil.locator('#nav-class').click();
  await pupil.locator('#res-list-0').check();
  await pupil.locator('#pupil-name').fill('Chan Tai Man');
  const res = await save(pupil, '#results-save');
  const r = JSON.parse(res.body) as {
    pupil: string;
    lists: { attempts: { right: number; wrong: number; blank: number }[] }[];
  };
  expect(r.pupil).toBe('Chan Tai Man');
  expect(r.lists[0]!.attempts).toHaveLength(1);
  expect(res.body).not.toContain('color'); // typed answers never leave the device

  // Teacher opens two results files (one pupil twice: newest wins).
  const older = JSON.stringify({ ...r, madeAt: '2020-01-01T00:00:00Z', pupil: 'chan tai man' });
  const other = JSON.stringify({ ...r, pupil: 'Lee Siu Ming' });
  await page
    .locator('#results-files')
    .setInputFiles([file('a.json', res.body), file('b.json', older), file('c.json', other)]);
  await expect(page.locator('#summary-pupils')).toContainText('2 pupil(s).');
  await expect(page.locator('#summary-pupils')).toContainText('1 older file(s)');
  await expect(page.locator('#summary-table-0 tbody tr')).toHaveCount(2);
  await expect(page.locator('#summary-table-0 tbody tr').first()).toContainText('Chan Tai Man');
  const csv = await save(page, '#summary-csv');
  expect(csv.body).toContain('pupil,list,tries,best,last day,last');
  expect(csv.body).toContain('Lee Siu Ming');
  // A broken results file names the file.
  await page.locator('#results-files').setInputFiles([file('broken.json', '{"format":"x"}')]);
  await expect(page.locator('#banner')).toContainText('broken.json');

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );
  for (const x of [w, w2]) {
    expect(x.external).toEqual([]);
    expect(x.nonGet).toEqual([]);
    expect(x.errors).toEqual([]);
  }
  await pupilCtx.close();
});
