/**
 * A-09 の通し確認をブラウザ越しに行う（仕様書8.1.4、6.3、受入試験T-09）。
 *
 * 結合テスト（`tests/integration/templateRevisionIsolation.test.js`）と同じ
 * 4手順を、画面操作だけで辿る。
 *
 *   1. テンプレートから実施回を作成する
 *   2. 元テンプレートを改訂する
 *   3. 改訂前に作成した実施回の構成が変化しないことを確認する
 *   4. 改訂後に新しく作成した実施回には新しいテンプレート内容が反映される
 *
 * 結合テストが保存層の往復を押さえるのに対し、こちらは画面が古い内容を
 * 再取得していないか、表示が改訂へ引きずられていないかを見る。
 */

import { expect, test } from '@playwright/test';

import {
  createProject,
  createRun,
  openFresh,
  openProject,
  openRun,
  readTaskCodes,
  readTaskNames,
} from './helpers.js';

/** サンプルの対象種別A / 標準の作業項目（版1）。 */
const VERSION_1_NAMES = ['受入確認', '前処理', '本作業', '検査', '後片付け'];
const VERSION_1_CODES = ['X-100', 'X-200', 'X-1000', 'X-1100', 'X-1200'];

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

/**
 * 手順1〜2を実行する。
 *
 * 改訂の内容は、名称の変更・外部項目コードの変更・作業項目の無効化・項目の追加を
 * ひととおり含める。1種類だけでは他の経路の漏れに気づけない。
 */
async function createRunThenRevise(page) {
  // 1. 案件と実施回を作る
  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 500 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

  // 2. 元テンプレートを改訂する
  await page.getByTestId('nav-templates').click();
  const row = page
    .getByTestId('template-row')
    .filter({ hasText: '対象種別A' })
    .filter({ hasText: '標準' });
  await row.getByTestId('select-template').click();
  await expect(page.getByTestId('template-editor')).toBeVisible();

  const rows = page.getByTestId('task-row');
  // 名称と外部項目コードを変える
  await rows.nth(0).getByTestId('task-name').fill('受入確認（改）');
  await rows.nth(0).getByTestId('task-code').fill('X-101');
  // 作業項目を無効化する
  await rows.nth(1).getByTestId('task-active').uncheck();
  // 項目を追加する
  await page.getByTestId('add-task').first().click();
  const added = page.getByTestId('task-row').last();
  await added.getByTestId('task-name').fill('追加加工');
  await added.getByTestId('task-code').fill('X-2000');

  await page.getByTestId('revise').click();
  await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版2');
}

test('手順2: 改訂で版が繰り上がる（仕様書8.1.3）', async ({ page }) => {
  await createRunThenRevise(page);

  await expect(page.getByTestId('editor-heading')).toContainText('版2');
});

test('T-09 手順3: 改訂前に作成した実施回の作業項目名が変化しない（A-09）', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  expect(await readTaskNames(page)).toEqual(VERSION_1_NAMES);
});

test('手順3: 外部項目コードが変化しない', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  expect(await readTaskCodes(page)).toEqual(VERSION_1_CODES);
});

test('手順3: 表示順が変化しない', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  // 表示順の並びそのものが版1のままである。
  expect(await readTaskNames(page)).toEqual(VERSION_1_NAMES);
});

test('手順3: 無効化した作業項目が既存実施回から消えない', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  // 改訂で「前処理」を無効にしたが、既存実施回には残る。
  expect(await readTaskNames(page)).toContain('前処理');
});

test('手順3: 追加した作業項目が既存実施回へ現れない', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  const names = await readTaskNames(page);
  expect(names).not.toContain('追加加工');
  expect(names).toHaveLength(5);
});

test('手順3: 生成元のテンプレート版の表示も変わらない', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  await expect(page.getByTestId('run-template-version')).toContainText('版1');
});

test('手順3: 再読み込みしても既存実施回は版1の内容を保つ', async ({ page }) => {
  await createRunThenRevise(page);

  await page.reload();
  await openProject(page, 'PJ-0001');
  await openRun(page, 0);

  expect(await readTaskNames(page)).toEqual(VERSION_1_NAMES);
});

test('手順4: 改訂後に作成した実施回へ新しい内容が反映される', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await createRun(page, { workDate: '2026-08-02', runQuantity: 50 });
  await openProject(page, 'PJ-0001');
  await openRun(page, 1);

  expect(await readTaskNames(page)).toEqual([
    // 名称の変更が反映される
    '受入確認（改）',
    // 無効化した「前処理」は生成されない（仕様書8.1.5）
    '本作業',
    '検査',
    '後片付け',
    // 追加した項目が生成される
    '追加加工',
  ]);
});

test('手順4: 外部項目コードの変更も反映される', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await createRun(page, { workDate: '2026-08-02', runQuantity: 50 });
  await openProject(page, 'PJ-0001');
  await openRun(page, 1);

  expect(await readTaskCodes(page)).toEqual([
    'X-101',
    'X-1000',
    'X-1100',
    'X-1200',
    'X-2000',
  ]);
});

test('手順4: 新しい実施回は版2から生成されたと表示する', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await createRun(page, { workDate: '2026-08-02', runQuantity: 50 });
  await openProject(page, 'PJ-0001');
  await openRun(page, 1);

  await expect(page.getByTestId('run-template-version')).toContainText('版2');
});

test('手順4: 生成対象の候補に無効化した項目が出ない（仕様書8.3.1）', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await page.getByTestId('add-run-toggle').click();

  const selection = page.getByTestId('task-selection');
  await expect(selection).toContainText('受入確認（改）');
  await expect(selection).toContainText('追加加工');
  await expect(selection).not.toContainText('前処理');
});

test('改訂前と改訂後の実施回が別々の内容で共存する', async ({ page }) => {
  await createRunThenRevise(page);

  await openProject(page, 'PJ-0001');
  await createRun(page, { workDate: '2026-08-02', runQuantity: 50 });

  await openProject(page, 'PJ-0001');
  await openRun(page, 0);
  const first = await readTaskNames(page);

  await openProject(page, 'PJ-0001');
  await openRun(page, 1);
  const second = await readTaskNames(page);

  expect(first).toEqual(VERSION_1_NAMES);
  expect(second).toContain('受入確認（改）');
  expect(first).not.toEqual(second);
});

test('実施回詳細に改訂の影響を受けない旨が書かれている', async ({ page }) => {
  await createProject(page, { projectId: 'PJ-0001', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 50 });

  await expect(page.getByTestId('detail-pane')).toContainText('テンプレート改訂の影響を受けません');
});
