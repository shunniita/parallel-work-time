/**
 * レイアウト目視確認用のスクリーンショット取得（仕様書12.1、13章）。
 *
 * 主要幅（1280 / 1440）と狭幅（1024）で崩壊が無いことを人が見るための補助であり、
 * 合否判定は行わない。`--grep @screenshot` で実行する。
 */

import { expect, test } from '@playwright/test';

import { createProject, createRun, openFresh, openProject } from './helpers.js';

const WIDTHS = [1280, 1440, 1024];

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

for (const width of WIDTHS) {
  test(`@screenshot ${width}px テンプレート画面`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    const row = page
      .getByTestId('template-row')
      .filter({ hasText: '対象種別A' })
      .filter({ hasText: '標準' });
    await row.getByTestId('select-template').click();
    await expect(page.getByTestId('template-editor')).toBeVisible();

    await page.screenshot({ path: `test-results/template-${width}.png`, fullPage: true });
  });

  test(`@screenshot ${width}px 案件詳細`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });

    await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
    await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });
    await openProject(page, 'PJ-0001');

    await page.screenshot({ path: `test-results/project-${width}.png`, fullPage: true });
  });
}

test('@screenshot 実施回詳細', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });

  await page.screenshot({ path: 'test-results/run-detail.png', fullPage: true });
});

test('@screenshot 案件IDの衝突と実施回追加の導線', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });
  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });
  await expect(page.getByTestId('project-conflict')).toBeVisible();

  await page.screenshot({ path: 'test-results/project-conflict.png', fullPage: true });
});

test('@screenshot 累計超過の確認', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });

  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  await page.getByTestId('work-date').fill('2026-08-01');
  await page.getByTestId('run-quantity-input').fill('150');
  await page.getByTestId('create-run').click();
  await expect(page.getByTestId('overflow-confirm')).toBeVisible();

  await page.screenshot({ path: 'test-results/overflow-confirm.png', fullPage: true });
});
