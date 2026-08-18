/** JSON入出力のE2E（仕様書9.2〜9.4、T-11、T-12）。 */

import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';

import { createProject, openFresh } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

test('JSONエクスポートは仕様どおりの名前と全データを含む（仕様書9.2）', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-BACKUP', totalQuantity: 100 });
  await page.getByTestId('nav-settings').click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(
    /^parallel-work-time_\d{8}-\d{6}\.json$/,
  );
  const payload = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(Object.keys(payload).sort()).toEqual([
    'changeHistory',
    'exportedAt',
    'projectGroups',
    'schemaVersion',
    'settings',
    'taskTemplates',
    'workRuns',
  ]);
  expect(payload.projectGroups).toHaveLength(1);
  expect(payload.projectGroups[0].projectId).toBe('PJ-BACKUP');
  await expect(page.getByTestId('last-exported-at')).toContainText('最終エクスポート');
});

test('T-11 退避して全置換インポートするとエクスポート時点へ戻る（A-11）', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-BEFORE', totalQuantity: 100 });
  await page.getByTestId('nav-settings').click();

  const exportPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const exported = await exportPromise;
  const exportedPath = await exported.path();

  await page.getByTestId('nav-projects').click();
  await createProject(page, { projectId: 'PJ-AFTER', totalQuantity: 100 });
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('import-file').setInputFiles(exportedPath);
  await expect(page.getByTestId('import-choice')).toBeVisible();

  const safetyDownload = page.waitForEvent('download');
  await page.getByTestId('import-with-backup').click();
  await safetyDownload;
  await expect(page.getByTestId('settings-message')).toContainText('置き換えました');

  await page.getByTestId('nav-projects').click();
  await expect(page.getByTestId('tree-project')).toHaveCount(1);
  await expect(page.getByTestId('tree-project')).toContainText('PJ-BEFORE');
  await expect(page.getByText('PJ-AFTER', { exact: true })).toHaveCount(0);
});

test('T-12 壊れたJSONでは既存データを変更しない（A-12）', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-KEEP', totalQuantity: 100 });
  await page.getByTestId('nav-settings').click();

  await page.getByTestId('import-file').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  });

  await expect(page.getByTestId('settings-errors')).toContainText('JSONとして読み取れません');
  await expect(page.getByTestId('import-choice')).toHaveCount(0);
  await page.getByTestId('nav-projects').click();
  await expect(page.getByTestId('tree-project')).toContainText('PJ-KEEP');
});

test('退避なしは取り消せない旨を再確認する（仕様書9.4）', async ({ page }) => {
  await page.getByTestId('nav-settings').click();
  const exportPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const exported = await exportPromise;

  await page.getByTestId('import-file').setInputFiles(await exported.path());
  await page.getByTestId('import-without-backup').click();

  await expect(page.getByTestId('import-skip-panel')).toContainText('取り消せません');
  await expect(page.getByTestId('import-skip-accept')).toHaveText('退避せず全置換する');
});

test('取り込みボタンを連打しても全置換は1回だけ走る（過去のレビュー指摘）', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-DOUBLE', totalQuantity: 100 });
  await page.getByTestId('nav-settings').click();

  const exportPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const exported = await exportPromise;

  await page.getByTestId('import-file').setInputFiles(await exported.path());
  await expect(page.getByTestId('import-choice')).toBeVisible();

  // 退避ダウンロードの回数で、排他区間が何回走ったかを数える。
  const backups = [];
  page.on('download', (download) => backups.push(download.suggestedFilename()));

  const button = page.getByTestId('import-with-backup');
  await button.dblclick();

  await expect(page.getByTestId('settings-message')).toContainText('置き換えました');
  // 置換が終わると確認パネル自体が畳まれる。押し直す先が無い。
  await expect(page.getByTestId('import-choice')).toHaveCount(0);
  expect(backups).toHaveLength(1);

  await page.getByTestId('nav-projects').click();
  await expect(page.getByTestId('tree-project')).toHaveCount(1);
});
