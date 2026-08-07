/**
 * アーカイブと完全削除の受入試験（仕様書10章、11章）。
 *
 * 対応する試験例は T-10（A-10 転記済み→アーカイブ→`archivedAt` から保持期間経過
 * で削除候補）である。完全削除と退避は受入試験例に個別の番号を持たないため、
 * 通しの導線1本にまとめた。
 *
 * 30日待てないため、保持期間を設定画面から小さくして再現する（仕様書10.2 が
 * 設定変更を許している）。自動削除は行わないため（10.6）、候補として表示される
 * ことだけを確認する。
 */

import { expect, test } from '@playwright/test';

import { createProject, createRun, openFresh } from './helpers.js';

/**
 * 作業項目の行を名前で引く。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
function taskRow(page, name) {
  return page.getByTestId('task-row').filter({ hasText: name });
}

/** 案件と実施回を1件ずつ作り、記録を入れて転記済みまで進める。 */
async function toTransferred(page, projectId) {
  await openFresh(page);
  await createProject(page, { projectId, totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });

  // 直接入力で工数を1件入れる（区間より手数が少ない）。
  await taskRow(page, '受入確認').getByTestId('open-task').click();
  await page.getByTestId('op-directEntry').click();
  const form = page.getByTestId('direct-form');
  await form.getByTestId('direct-duration-minutes').fill('10');
  await form.getByTestId('direct-note').fill('計測漏れ');
  await form.getByTestId('direct-submit').click();
  await expect(form).toBeHidden();
  await page.getByTestId('back-to-run').click();

  await page.getByTestId('nav-summary').click();
  await page.getByTestId('mark-aggregated').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('集計済み');
  await page.getByTestId('mark-transferred').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('転記済み');
}

/** 保持期間を設定画面から変える（仕様書10.2）。 */
async function setRetentionDays(page, days) {
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('retention-days').fill(String(days));
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('settings-message')).toContainText('保存しました');
}

test('T-10 転記済み→アーカイブ→保持期間経過で削除候補（A-10）', async ({ page }) => {
  await toTransferred(page, 'PJ-T10');

  // アーカイブは利用者の操作によってのみ行う（仕様書10.1）。
  await page.getByTestId('archive-run').click();
  await expect(page.getByTestId('summary-empty').or(page.getByTestId('summary-list'))).toBeVisible();

  await page.getByTestId('nav-archive').click();
  await expect(page.getByTestId('archive-row')).toHaveCount(1);

  // 保持期間30日のうちは候補にならない。
  await expect(page.getByTestId('archive-remaining')).toContainText('あと');
  await expect(page.getByTestId('archive-summary')).toContainText('削除候補 0件');

  // 保持期間を0日にすると、経過済みとして候補に入る。
  await setRetentionDays(page, 1);
  await page.getByTestId('nav-archive').click();
  await expect(page.getByTestId('archive-summary')).toContainText('保持期間 1日');

  // 自動削除はしない（仕様書10.6）。レコードは残ったままである。
  await expect(page.getByTestId('archive-row')).toHaveCount(1);
});

test('アーカイブへ移すと通常の一覧から消える（仕様書10.1）', async ({ page }) => {
  await toTransferred(page, 'PJ-SPLIT');

  await page.getByTestId('archive-run').click();

  // 案件詳細の実施回一覧から消える。
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await expect(page.getByTestId('run-list-empty')).toContainText('アーカイブ済み1件');

  // アーカイブ画面では見える。
  await page.getByTestId('nav-archive').click();
  await expect(page.getByTestId('archive-row')).toHaveCount(1);
});

test('アーカイブ済みは番号を保つ（レビュー指摘 D-14）', async ({ page }) => {
  await openFresh(page);
  await createProject(page, { projectId: 'PJ-NUM', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('add-run-toggle').click();
  await page.getByTestId('work-date').fill('2026-08-02');
  await page.getByTestId('run-quantity-input').fill('10');
  await page.getByTestId('create-run').click();
  await expect(page.getByTestId('task-list')).toBeVisible();

  // 第1回を転記済み→アーカイブへ進める。
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  await page.getByTestId('nav-summary').click();
  await page.getByTestId('mark-aggregated').click();
  await page.getByTestId('mark-transferred').click();
  await page.getByTestId('archive-run').click();

  // 残った第2回は「第2回」のままである。繰り上がらない。
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await expect(page.getByTestId('run-row')).toHaveCount(1);
  await expect(page.getByTestId('run-row').first()).toContainText('第2回');
});

test('退避してから完全削除し、変更履歴が残る（仕様書10.4、10.5、11章）', async ({ page }) => {
  await toTransferred(page, 'PJ-DEL');
  await page.getByTestId('archive-run').click();
  await page.getByTestId('nav-archive').click();

  // 理由を入れるまで退避の確認へ進まない（仕様書11章）。
  await page.getByTestId('delete-run').click();
  const reason = page.getByTestId('archive-delete-confirm-panel');
  await expect(reason).toBeVisible();
  await reason.getByTestId('archive-delete-confirm').click();
  await expect(reason.getByTestId('archive-delete-errors')).toContainText('理由');

  await reason.getByTestId('archive-delete-reason').fill('保持期間を過ぎたため');
  await reason.getByTestId('archive-delete-confirm').click();

  // 退避の選択が出る（仕様書10.5）。
  const backup = page.getByTestId('backup-choice');
  await expect(backup).toBeVisible();
  await backup.getByTestId('delete-without-backup').click();

  await expect(page.getByTestId('archive-notice')).toContainText('削除しました');
  await expect(page.getByTestId('archive-empty')).toBeVisible();

  // 変更履歴はエクスポートJSONへ残る（仕様書9.2、11章）。
  const history = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('parallel-work-time');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise((resolve, reject) => {
      const tx = db.transaction(['changeHistory'], 'readonly');
      const req = tx.objectStore('changeHistory').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return entries;
  });

  expect(history).toHaveLength(1);
  expect(history[0].operation).toBe('workRunDeleted');
  expect(history[0].reason).toBe('保持期間を過ぎたため');
  expect(history[0].summary).toContain('PJ-DEL');
});

test('案件は配下がすべてアーカイブ済みのときだけ削除できる（仕様書10.4）', async ({ page }) => {
  await openFresh(page);
  await createProject(page, { projectId: 'PJ-GRP', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('add-run-toggle').click();
  await page.getByTestId('work-date').fill('2026-08-02');
  await page.getByTestId('run-quantity-input').fill('10');
  await page.getByTestId('create-run').click();
  await expect(page.getByTestId('task-list')).toBeVisible();

  // 第1回だけアーカイブする。
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  await page.getByTestId('nav-summary').click();
  await page.getByTestId('mark-aggregated').click();
  await page.getByTestId('mark-transferred').click();
  await page.getByTestId('archive-run').click();

  await page.getByTestId('nav-archive').click();
  const groupButton = page.getByTestId('delete-group');
  await expect(groupButton).toBeDisabled();
  await expect(groupButton).toHaveAttribute('title', /1 件/);
});
