/**
 * レイアウト目視確認用のスクリーンショット取得（仕様書12.1、13章）。
 *
 * 主要幅（1280 / 1440）と狭幅（1024）で崩壊が無いことを人が見るための補助であり、
 * 合否判定は行わない。`--grep @screenshot` で実行する。
 */

import { expect, test } from '@playwright/test';

const WIDTHS = [1280, 1440, 1024];

for (const width of WIDTHS) {
  test(`@screenshot ${width}px のレイアウト`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('template-list')).toBeVisible();

    const row = page
      .getByTestId('template-row')
      .filter({ hasText: '対象種別A' })
      .filter({ hasText: '標準' });
    await row.getByTestId('select-template').click();
    await expect(page.getByTestId('template-editor')).toBeVisible();

    await page.screenshot({
      path: `test-results/layout-${width}.png`,
      fullPage: true,
    });
  });
}

test('@screenshot 新規登録フォームとエラー表示', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await expect(page.getByTestId('template-list')).toBeVisible();

  await page.getByTestId('new-template-toggle').click();
  await page.getByTestId('new-variant').fill('標準');
  // 対象種別と作業項目名を空のまま登録し、エラー表示を出す。
  await page.getByTestId('create').click();
  await expect(page.getByTestId('template-errors')).toBeVisible();

  await page.screenshot({ path: 'test-results/create-form-errors.png', fullPage: true });
});
