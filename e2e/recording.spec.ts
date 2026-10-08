// SPDX-License-Identifier: AGPL-3.0-or-later
// The parent's own recording: made with Chromium's fake microphone, kept in IndexedDB
// across reloads, played back, preferred over a device voice, and never uploaded.
import { expect, test } from '@playwright/test';
import { fakeSpeech, fastSettings, makeList, open, spoken, watch } from './helpers';

const executablePath = process.env.PW_CHROMIUM_PATH;
test.use({
  launchOptions: {
    ...(executablePath ? { executablePath } : {}),
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
  permissions: ['microphone'],
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('e2e-init')) {
      sessionStorage.setItem('e2e-init', '1');
      indexedDB.deleteDatabase('dictalark');
    }
  });
});

test('record a word → reload → it plays → the dictation uses it → nothing leaves the device', async ({
  page,
  baseURL,
}) => {
  const w = watch(page, baseURL!);
  await fakeSpeech(page);
  await open(page);
  await page.locator('#set-lang').selectOption('en');
  await makeList(page, 'Recorded', ['lark', 'wren']);
  await page.locator('#rec-0').click();
  await expect(page.locator('#rec-0')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1500);
  await page.locator('#rec-0').click();
  await expect(page.locator('#items-table tbody tr').nth(0)).toHaveAttribute(
    'data-has-recording',
    'true',
  );
  await expect(page.locator('#banner')).toContainText('Recording saved on this device');

  await page.reload();
  await page.locator('body[data-ready="true"]').waitFor();
  await expect(page.locator('#items-table tbody tr').nth(0)).toHaveAttribute(
    'data-has-recording',
    'true',
  );
  await expect(page.locator('#items-table tbody tr').nth(1)).toHaveAttribute(
    'data-has-recording',
    'false',
  );
  const stored = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const r = indexedDB.open('dictalark');
        r.onsuccess = () => {
          const g = r.result.transaction('recordings').objectStore('recordings').getAll();
          g.onsuccess = () => resolve((g.result as { bytes: number }[])[0]?.bytes ?? 0);
          g.onerror = () => reject(g.error);
        };
        r.onerror = () => reject(r.error);
      }),
  );
  expect(stored).toBeGreaterThan(500);
  await page.locator('#play-0').click();
  await expect(page.locator('body')).toHaveAttribute('data-last-playback', 'ended', {
    timeout: 10_000,
  });

  // In a dictation the recording is used for word 1; the device voice only for word 2.
  await page.evaluate(() => {
    delete document.body.dataset.lastPlayback;
  });
  await page.locator('#practise-link').click();
  await fastSettings(page);
  await page.locator('#btn-start').click();
  await expect(page.locator('#results-list li')).toHaveCount(2, { timeout: 15_000 });
  await expect(page.locator('body')).toHaveAttribute('data-last-playback', 'ended');
  expect((await spoken(page)).map((s) => s.text)).toEqual(['wren']);

  // Deleting the recording removes it from storage.
  await page.locator('#btn-again').waitFor();
  await page.goto(page.url().replace(/#.*$/, '#/'));
  await page.locator('#lists li a').first().click();
  await page.locator('#delrec-0').click();
  await expect(page.locator('#items-table tbody tr').nth(0)).toHaveAttribute(
    'data-has-recording',
    'false',
  );

  expect(w.external).toEqual([]);
  expect(w.nonGet).toEqual([]);
  expect(w.errors).toEqual([]);
});
