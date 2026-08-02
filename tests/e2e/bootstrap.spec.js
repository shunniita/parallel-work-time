/**
 * 起動とサンプルテンプレート初回投入のE2E（仕様書5.2、8.1.6）。
 *
 * 画面越しの確認に絞る。保存層そのものの検証は
 * `tests/integration/bootstrap.test.js` が担う。
 */

import { expect, test } from '@playwright/test';

import { SAMPLE_COUNT, openFresh } from './helpers.js';

test('初回起動でサンプルテンプレートが投入される（仕様書8.1.6）', async ({ page }) => {
  await openFresh(page);

  await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
});

test('再読み込みしても件数が増えない', async ({ page }) => {
  await openFresh(page);
  await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);

  await page.reload();

  await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
});

test('起動時点では保存状態が未操作である（仕様書9.1）', async ({ page }) => {
  await openFresh(page);

  await expect(page.getByTestId('save-status')).toHaveText('—');
});

test('外部オリジンへの要求が発生しない（仕様書5.1.4、13章）', async ({ page }) => {
  const external = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:')) {
      external.push(request.url());
    }
  });

  await openFresh(page);
  await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);

  expect(external).toEqual([]);
});
