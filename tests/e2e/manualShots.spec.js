/**
 * 説明書（manual/）用スクリーンショットの撮影。`--grep @manual` で実行する。
 *
 * 出力先は `manual/images/`（Git管理下）である。`test-results/` のレイアウト確認用
 * （`screenshots.spec.js`）と違い、撮った画像は説明書の一部としてコミットし、
 * 配布ZIPへも同梱される。UIを変えたら `npm run shots:manual` で撮り直す。
 *
 * 1本の通し操作で全画面を撮る。画面ごとに別テストで作り直すより、ツリーの内容や
 * 案件IDが全画像で一貫し、説明書の読者が同じデータを追いかけられる。
 *
 * 時刻は固定する。保存状態表示が実行時刻を出すため、固定しないと撮り直すたびに
 * 画像が変わり、内容の差と撮影時刻の差を見分けられない。
 *
 * データはすべて架空とする（仕様書14章）。
 */

import { expect, test } from '@playwright/test';

import { createProject, createRun, openFresh } from './helpers.js';

/** 撮影時点のブラウザ時刻。記録する区間（09:00〜12:00）より後にする。 */
const CAPTURE_TIME = new Date('2026-08-01T13:00:00+09:00');

/** 全画像の共通ビューポート。説明書は1280px幅の表示で統一する。 */
const VIEWPORT = { width: 1280, height: 900 };

function shot(page, name) {
  return page.screenshot({ path: `manual/images/${name}.png`, fullPage: true });
}

function taskRow(page, name) {
  return page.getByTestId('task-row').filter({ hasText: name });
}

/** `datetime-local` へ値を入れる。秒0はブラウザの正規化に合わせて落とす。 */
async function fillDateTime(locator, value) {
  await locator.fill(value.replace(/:00$/, ''));
}

/** 実施回詳細の行から操作を実行する。 */
async function operate(page, input) {
  const row = taskRow(page, input.task);
  await row.getByTestId(`row-op-${input.operation}`).click();

  const form = page.getByTestId('op-form');
  await expect(form).toBeVisible();
  await fillDateTime(form.getByTestId('op-at'), input.at);
  for (const participant of input.participants ?? []) {
    await form.getByTestId('op-participants').fill(participant);
    await form.getByTestId('op-participants-add').click();
  }
  await form.getByTestId('op-submit').click();
  await expect(form).toBeHidden();
}

test('@manual 説明書用スクリーンショット一式', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.clock.install({ time: CAPTURE_TIME });
  await page.setViewportSize(VIEWPORT);
  await openFresh(page);

  // --- テンプレート画面（編集欄を開いた状態） ---
  const templateRow = page
    .getByTestId('template-row')
    .filter({ hasText: '対象種別A' })
    .filter({ hasText: '標準' });
  await templateRow.getByTestId('select-template').click();
  await expect(page.getByTestId('template-editor')).toBeVisible();
  await shot(page, 'screen-templates');

  // --- 案件登録画面（入力済みの状態） ---
  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('project-form')).toBeVisible();
  await page.getByTestId('project-id').fill('PJ-0001');
  await page.getByTestId('target-type').fill('対象種別A');
  await page.getByTestId('variant').fill('標準');
  await page.getByTestId('total-quantity').fill('100');
  await shot(page, 'screen-project-form');
  await page.getByTestId('create-project').click();

  // 実施回を1件作る。
  await createRun(page, { workDate: '2026-08-01', runQuantity: 40 });

  // --- 記録を入れる ---
  // 受入確認: 開始 → 休憩 → 再開 → 終了（完了になる）。
  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T09:00:00',
    participants: ['甲', '乙'],
  });
  await operate(page, { task: '受入確認', operation: 'break', at: '2026-08-01T10:30:00' });
  await operate(page, { task: '受入確認', operation: 'resume', at: '2026-08-01T10:45:00' });
  await operate(page, { task: '受入確認', operation: 'finish', at: '2026-08-01T12:00:00' });
  // 前処理: 開始したまま（作業中）。警告領域の未終了区間を写すため。
  await operate(page, {
    task: '前処理',
    operation: 'start',
    at: '2026-08-01T09:05:00',
    participants: ['丙'],
  });

  // --- 実施回詳細（完了と作業中が混ざった状態） ---
  await expect(taskRow(page, '受入確認').getByTestId('task-state')).toHaveText('完了');
  await shot(page, 'screen-run');

  // --- 警告領域（未終了区間1件） ---
  await expect(page.getByTestId('warning-open-count')).toHaveText('未終了の区間 1件');
  await page.getByTestId('warning-bar').screenshot({ path: 'manual/images/warning-bar.png' });

  // --- 作業項目詳細（区間履歴と直接入力が写る状態） ---
  await taskRow(page, '受入確認').getByTestId('open-task').click();
  await page.getByTestId('op-directEntry').click();
  const directForm = page.getByTestId('direct-form');
  await directForm.getByTestId('direct-duration-minutes').fill('10');
  await directForm.getByTestId('direct-note').fill('計測漏れ分を追加');
  await directForm.getByTestId('direct-submit').click();
  await expect(directForm).toBeHidden();
  await expect(page.getByTestId('interval-row')).toHaveCount(3);
  await shot(page, 'screen-task');

  // --- 案件詳細 ---
  await page.getByTestId('tree-project').filter({ hasText: 'PJ-0001' }).click();
  await expect(page.getByTestId('project-title')).toHaveText('PJ-0001');
  await shot(page, 'screen-project');

  // --- 集計・転記（全区間を閉じて転記値が確定した状態） ---
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  await operate(page, { task: '前処理', operation: 'finish', at: '2026-08-01T11:00:00' });
  await page.getByTestId('nav-summary').click();
  await expect(page.getByTestId('summary-list')).toBeVisible();
  await shot(page, 'screen-summary');

  // --- アーカイブ（1件入った状態） ---
  await page.getByTestId('mark-aggregated').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('集計済み');
  await page.getByTestId('mark-transferred').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('転記済み');
  await page.getByTestId('archive-run').click();
  await page.getByTestId('nav-archive').click();
  await expect(page.getByTestId('archive-row')).toHaveCount(1);
  await shot(page, 'screen-archive');

  // --- 設定・バックアップ ---
  await page.getByTestId('nav-settings').click();
  await expect(page.getByTestId('settings-form')).toBeVisible();
  await shot(page, 'screen-settings');

  // --- インポートの置換確認 ---
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const download = await downloadPromise;
  // 画面にはファイル名が写る。`download.path()` の一時名は実行ごとに変わるため、
  // 固定名で保存し直してから選ぶ。
  const backupPath = testInfo.outputPath('backup.json');
  await download.saveAs(backupPath);
  await page.getByTestId('import-file').setInputFiles(backupPath);
  await expect(page.getByTestId('import-choice')).toBeVisible();
  await shot(page, 'screen-import-confirm');
});
