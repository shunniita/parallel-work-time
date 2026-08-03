/**
 * 時刻入力の受入試験（仕様書8.4、12.4）。
 *
 * 対応する試験例は T-03（A-03 複数項目の同時作業）、T-07 と T-13（A-04 休憩を
 * 除いた工数と日跨ぎ）、T-15（A-14 参加者候補）、T-17（A-17 未終了区間の個数）
 * である。参加者変更（T-16、A-16）は次の段階で足す。
 *
 * 画面の分岐そのものは単体テスト（`tests/unit/ui/`）で固定してある。ここでは
 * 実ブラウザで通しの導線が動くことだけを見る。
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

/**
 * `datetime-local` へ値を入れる。
 *
 * ブラウザは秒が0の値を `hh:mm` へ正規化する。`hh:mm:00` のまま `fill()` すると
 * 「入れた値と読み出した値が違う」と判定されて Malformed value になるため、
 * 秒が0の場合だけ落として渡す。指す時刻は変わらない。
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {string} value `YYYY-MM-DDThh:mm:ss`
 */
async function fillDateTime(locator, value) {
  await locator.fill(value.replace(/:00$/, ''));
}

/**
 * 行から操作を実行する。日時と参加者を確かめてから確定する（仕様書12.4）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{task: string, operation: string, at: string, participants?: string[]}} input
 */
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

/** 案件と実施回を1件ずつ作り、実施回詳細を開いた状態にする。 */
async function setup(page, projectId) {
  await openFresh(page);
  await createProject(page, { projectId, totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });
}

test('T-03 作業項目AとBを同時に開始できる（A-03）', async ({ page }) => {
  await setup(page, 'PJ-T03');

  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T09:00:00',
    participants: ['甲'],
  });
  await operate(page, {
    task: '前処理',
    operation: 'start',
    at: '2026-08-01T09:05:00',
    participants: ['乙'],
  });

  await expect(taskRow(page, '受入確認').getByTestId('task-state')).toHaveText('作業中');
  await expect(taskRow(page, '前処理').getByTestId('task-state')).toHaveText('作業中');

  // 片方を終了しても、もう片方は作業中のままである。
  await operate(page, { task: '受入確認', operation: 'finish', at: '2026-08-01T10:00:00' });

  await expect(taskRow(page, '受入確認').getByTestId('task-state')).toHaveText('完了');
  await expect(taskRow(page, '前処理').getByTestId('task-state')).toHaveText('作業中');
});

test('T-07 作業・休憩・再開を入力すると休憩が工数へ含まれない（A-04）', async ({ page }) => {
  await setup(page, 'PJ-T07');

  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T09:00:00',
    participants: ['甲', '乙'],
  });
  await operate(page, { task: '受入確認', operation: 'break', at: '2026-08-01T12:00:00' });
  await operate(page, { task: '受入確認', operation: 'resume', at: '2026-08-01T13:00:00' });
  await operate(page, { task: '受入確認', operation: 'finish', at: '2026-08-01T18:00:00' });

  // (3時間 + 5時間) × 2人 = 960分。休憩の1時間は入らない。
  const row = taskRow(page, '受入確認');
  await expect(row.getByTestId('task-state')).toHaveText('完了');
  await expect(row.getByTestId('task-time')).toHaveText('960分');
  await expect(row.getByTestId('task-transfer')).toHaveText('960分');

  // 区間履歴は 作業 → 休憩 → 作業 の3件になる。
  await row.getByTestId('open-task').click();
  await expect(page.getByTestId('interval-row')).toHaveCount(3);
  await expect(page.getByTestId('interval-type')).toHaveText(['作業', '休憩', '作業']);
  await expect(page.getByTestId('interval-effort')).toHaveText(['360分', '0分', '600分']);
  await expect(page.getByTestId('summary-transfer')).toHaveText('960分');
});

test('T-13 23時30分から翌1時15分の区間が105分になる（A-04）', async ({ page }) => {
  await setup(page, 'PJ-T13');

  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T23:30:00',
    participants: ['甲'],
  });
  await operate(page, { task: '受入確認', operation: 'finish', at: '2026-08-02T01:15:00' });

  await expect(taskRow(page, '受入確認').getByTestId('task-time')).toHaveText('105分');

  // 終了が翌日であることを区間履歴で読み取れる（仕様書8.4.8）。
  await taskRow(page, '受入確認').getByTestId('open-task').click();
  await expect(page.getByTestId('interval-start')).toHaveText('2026-08-01 23:30:00');
  await expect(page.getByTestId('interval-end')).toHaveText('2026-08-02 01:15:00');
});

test('T-15 参加者名が別の作業区間で候補表示される（A-14）', async ({ page }) => {
  await setup(page, 'PJ-T15');

  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T09:00:00',
    participants: ['甲', '乙'],
  });

  // 別の作業項目の開始フォームを開くと、過去に入力した名前が候補に出る。
  await taskRow(page, '前処理').getByTestId('row-op-start').click();
  const options = page.locator('#run-op-participants-options option');

  await expect(options).toHaveCount(2);
  await expect(page.locator('#run-op-participants-options option[value="甲"]')).toHaveCount(1);
  await expect(page.locator('#run-op-participants-options option[value="乙"]')).toHaveCount(1);
});

test('T-17 作業中は開始ボタンが出ず未終了区間が二重に作られない（A-17）', async ({ page }) => {
  await setup(page, 'PJ-T17');

  const row = taskRow(page, '受入確認');
  await expect(row.getByTestId('row-op-start')).toBeVisible();

  await operate(page, {
    task: '受入確認',
    operation: 'start',
    at: '2026-08-01T09:00:00',
    participants: ['甲'],
  });

  // 作業中の行に開始は出ない（仕様書12.4 の対応表）。
  await expect(row.getByTestId('row-op-start')).toHaveCount(0);
  await expect(row.getByTestId('row-op-break')).toBeVisible();

  // 詳細画面でも開始は無効のままである。
  await row.getByTestId('open-task').click();
  await expect(page.getByTestId('op-start')).toBeDisabled();
  await expect(page.getByTestId('op-break')).toBeEnabled();
  await expect(page.getByTestId('interval-row')).toHaveCount(1);
  await expect(page.getByTestId('interval-end')).toHaveText('進行中');
});

test('作業項目詳細から実施回へ戻れる（仕様書12.2）', async ({ page }) => {
  await setup(page, 'PJ-NAV');

  await taskRow(page, '受入確認').getByTestId('open-task').click();
  await expect(page.getByTestId('task-detail-title')).toHaveText('受入確認');

  await page.getByTestId('back-to-run').click();

  await expect(page.getByTestId('task-list')).toBeVisible();
});

test('転記済みの実施回では記録できない（仕様書7.2）', async ({ page }) => {
  await setup(page, 'PJ-LOCK');

  // 状態遷移の操作は Step 10 で実装する。ここでは保存層へ直接書いて作る。
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('parallel-work-time');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const runs = await new Promise((resolve, reject) => {
      const request = db.transaction(['workRuns'], 'readonly').objectStore('workRuns').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['workRuns'], 'readwrite');
      tx.objectStore('workRuns').put({ ...runs[0], status: 'transferred' });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.reload();

  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();

  await expect(page.getByTestId('run-not-editable')).toContainText('転記済み');
  await expect(taskRow(page, '受入確認').getByTestId('row-op-start')).toHaveCount(0);
});
