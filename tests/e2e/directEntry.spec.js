/**
 * 工数直接入力の受入試験（仕様書8.5、8.9.8、11章）。
 *
 * 対応する試験例は T-06（A-06 作業40分＋直接入力20分＝転記値60分）である。
 * 追加・編集・削除と重複候補の警告（8.9.8）は受入試験例に個別の番号を持たない
 * ため、通しの導線1本にまとめた。
 *
 * 画面の分岐そのものは単体テスト（`tests/unit/ui/taskDetailView.test.js`）で
 * 固定してある。ここでは実ブラウザで通しの導線が動くことだけを見る。
 */

import { expect, test } from '@playwright/test';

import { createProject, createRun, openFresh, openProject, openRun } from './helpers.js';

/**
 * 作業項目の行を名前で引く。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
function taskRow(page, name) {
  return page.getByTestId('task-row').filter({ hasText: name });
}

/** 案件と実施回を1件ずつ作り、作業項目詳細を開いた状態にする。 */
async function setup(page, projectId) {
  await openFresh(page);
  await createProject(page, { projectId, totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });
  await taskRow(page, '受入確認').getByTestId('open-task').click();
  await expect(page.getByTestId('task-detail-title')).toHaveText('受入確認');
}

/**
 * 直接入力を1件足す。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{minutes?: string, seconds?: string, participants?: string[], note: string}} input
 */
async function addDirectEntry(page, input) {
  await page.getByTestId('op-directEntry').click();
  const form = page.getByTestId('direct-form');
  await expect(form).toBeVisible();
  if (input.minutes !== undefined) {
    await form.getByTestId('direct-duration-minutes').fill(input.minutes);
  }
  if (input.seconds !== undefined) {
    await form.getByTestId('direct-duration-seconds').fill(input.seconds);
  }
  for (const participant of input.participants ?? []) {
    await form.getByTestId('direct-participants').fill(participant);
    await form.getByTestId('direct-participants-add').click();
  }
  await form.getByTestId('direct-note').fill(input.note);
  await form.getByTestId('direct-submit').click();
  await expect(form).toBeHidden();
}

test('T-06 作業40分＋直接入力20分で転記値60分になる（A-06）', async ({ page }) => {
  await setup(page, 'PJ-T06');

  // 作業40分を区間として記録する。
  await page.getByTestId('op-addInterval').click();
  const addForm = page.getByTestId('entry-form');
  await expect(addForm).toBeVisible();
  await addForm.getByTestId('entry-start').fill('2026-08-01T09:00');
  await addForm.getByTestId('entry-end').fill('2026-08-01T09:40');
  await addForm.getByTestId('entry-participants').fill('甲');
  await addForm.getByTestId('entry-participants-add').click();
  await addForm.getByTestId('entry-submit').click();
  await expect(addForm).toBeHidden();
  await expect(page.getByTestId('summary-time')).toHaveText('40分');

  await addDirectEntry(page, {
    minutes: '20',
    participants: ['甲'],
    note: '計測漏れ分を追加',
  });

  await expect(page.getByTestId('summary-direct')).toHaveText('20分');
  await expect(page.getByTestId('summary-transfer')).toHaveText('60分');

  // 実施回一覧の内訳にも同じ値が出る。
  await page.getByTestId('back-to-run').click();
  const row = taskRow(page, '受入確認');
  await expect(row.getByTestId('task-direct')).toHaveText('20分');
  await expect(row.getByTestId('task-transfer')).toHaveText('60分');
});

test('直接入力に参加者数を掛けない（仕様書8.5.6）', async ({ page }) => {
  await setup(page, 'PJ-NOMUL');

  // 3人を添えても20分のまま。`seconds` は既に人数を含んだ総工数である。
  await addDirectEntry(page, {
    minutes: '20',
    participants: ['甲', '乙', '丙'],
    note: '3人での計測漏れ分',
  });

  await expect(page.getByTestId('summary-direct')).toHaveText('20分');
  await expect(page.getByTestId('summary-transfer')).toHaveText('20分');
});

test('直接入力の追加・編集・削除ができる（仕様書8.5、11章）', async ({ page }) => {
  await setup(page, 'PJ-DIRECT');

  await expect(page.getByTestId('direct-empty')).toBeVisible();

  // 追加: 備考が無いと保存できない（仕様書8.5.4）。
  await page.getByTestId('op-directEntry').click();
  const form = page.getByTestId('direct-form');
  await expect(form).toBeVisible();
  await form.getByTestId('direct-duration-minutes').fill('20');
  await form.getByTestId('direct-duration-seconds').fill('30');
  await form.getByTestId('direct-submit').click();
  await expect(form.getByTestId('direct-errors')).toContainText('備考');

  await form.getByTestId('direct-participants').fill('甲');
  await form.getByTestId('direct-participants-add').click();
  await form.getByTestId('direct-note').fill('移動時間を追加');
  await form.getByTestId('direct-submit').click();
  await expect(form).toBeHidden();

  await expect(page.getByTestId('direct-row')).toHaveCount(1);
  await expect(page.getByTestId('direct-effort')).toHaveText('20分30秒');
  await expect(page.getByTestId('direct-participants')).toHaveText('甲');
  await expect(page.getByTestId('direct-note')).toHaveText('移動時間を追加');

  // 編集: 10分へ縮める。
  await page.getByTestId('direct-edit').click();
  const editForm = page.getByTestId('direct-form');
  await expect(editForm).toBeVisible();
  await expect(editForm.getByTestId('direct-duration-minutes')).toHaveValue('20');
  await expect(editForm.getByTestId('direct-duration-seconds')).toHaveValue('30');
  await editForm.getByTestId('direct-duration-minutes').fill('10');
  await editForm.getByTestId('direct-duration-seconds').fill('0');
  await editForm.getByTestId('direct-submit').click();
  await expect(editForm).toBeHidden();
  await expect(page.getByTestId('direct-effort')).toHaveText('10分0秒');
  await expect(page.getByTestId('summary-direct')).toHaveText('10分');

  // 削除: 理由を入力しないと確定できない（仕様書11章）。
  await page.getByTestId('direct-delete').click();
  const deleteConfirm = page.getByTestId('delete-confirm-panel');
  await expect(deleteConfirm).toBeVisible();
  await expect(deleteConfirm.getByTestId('delete-confirm-description')).toContainText('10分0秒');
  await expect(deleteConfirm.getByTestId('delete-confirm-description')).toContainText('移動時間を追加');
  await deleteConfirm.getByTestId('delete-confirm').click();
  await expect(deleteConfirm.getByTestId('delete-errors')).toContainText('理由');

  await deleteConfirm.getByTestId('delete-reason').fill('二重に記録していたため');
  await deleteConfirm.getByTestId('delete-confirm').click();
  await expect(deleteConfirm).toBeHidden();
  await expect(page.getByTestId('direct-empty')).toBeVisible();
  await expect(page.getByTestId('summary-direct')).toHaveText('0分');
});

test('同じ参加者・同じ工数を二度足すと重複候補を警告する（仕様書8.9.8）', async ({ page }) => {
  await setup(page, 'PJ-DUP');

  await addDirectEntry(page, { minutes: '20', participants: ['甲'], note: '移動時間' });
  await expect(page.getByTestId('task-warnings')).toBeHidden();

  await addDirectEntry(page, { minutes: '20', participants: ['甲'], note: '別の理由' });

  // 警告は出るが保存は止めない。
  await expect(page.getByTestId('task-warnings')).toContainText('二重登録');
  await expect(page.getByTestId('direct-row')).toHaveCount(2);
  await expect(page.getByTestId('summary-direct')).toHaveText('40分');
});

test('未着手の作業項目にも直接入力を足して編集できる（仕様書12.4）', async ({ page }) => {
  await setup(page, 'PJ-NOTSTARTED');

  // 区間が1件も無い状態。「履歴編集」は無効だが、直接入力の編集はできる。
  await expect(page.getByTestId('task-detail-state')).toHaveText('未着手');
  await expect(page.getByTestId('op-directEntry')).toBeEnabled();
  await expect(page.getByTestId('op-editHistory')).toBeDisabled();

  await addDirectEntry(page, { minutes: '15', note: '計測漏れ分' });

  await expect(page.getByTestId('direct-edit')).toBeVisible();
  await expect(page.getByTestId('direct-delete')).toBeVisible();
  // 直接入力だけでは作業項目の状態は変わらない。
  await expect(page.getByTestId('task-detail-state')).toHaveText('未着手');
});

test('直接入力が再読み込み後も残る（仕様書9.1）', async ({ page }) => {
  await setup(page, 'PJ-RELOAD');

  await addDirectEntry(page, { minutes: '20', participants: ['甲'], note: '移動時間' });

  await page.reload();
  await openProject(page, 'PJ-RELOAD');
  await openRun(page, 0);
  await taskRow(page, '受入確認').getByTestId('open-task').click();

  await expect(page.getByTestId('direct-effort')).toHaveText('20分0秒');
  await expect(page.getByTestId('summary-direct')).toHaveText('20分');
});
