/**
 * 集計・転記の受入試験（仕様書8.6.5、8.7、7.1、11章）。
 *
 * 対応する試験例は T-05（A-07 端数のある合計と転記値）と T-08（A-08 未終了区間が
 * あると未確定・集計済みにできない）である。状態遷移と転記値コピーは受入試験例に
 * 個別の番号を持たないため、通しの導線1本にまとめた。
 *
 * 画面の分岐そのものは単体テスト（`tests/unit/ui/summaryView.test.js`）で固定して
 * ある。ここでは実ブラウザで通しの導線が動くことだけを見る。
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
 * 集計行を作業項目名で引く。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
function summaryRow(page, name) {
  return page.getByTestId('summary-row').filter({ hasText: name });
}

/** 案件と実施回を1件ずつ作り、実施回詳細を開いた状態にする。 */
async function setup(page, projectId) {
  await openFresh(page);
  await createProject(page, { projectId, totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });
}

/**
 * 作業項目詳細で直接入力を1件足す。
 *
 * 集計の値を作るのに区間より手数が少ない。工数の出どころによらず合計へ入ることは
 * `directEntry.spec.js` が確かめている。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{task: string, minutes: string, seconds?: string, note: string}} input
 */
async function addDirectEntry(page, input) {
  await taskRow(page, input.task).getByTestId('open-task').click();
  await expect(page.getByTestId('task-detail-title')).toHaveText(input.task);

  await page.getByTestId('op-directEntry').click();
  const form = page.getByTestId('direct-form');
  await expect(form).toBeVisible();
  await form.getByTestId('direct-duration-minutes').fill(input.minutes);
  if (input.seconds !== undefined) {
    await form.getByTestId('direct-duration-seconds').fill(input.seconds);
  }
  await form.getByTestId('direct-note').fill(input.note);
  await form.getByTestId('direct-submit').click();
  await expect(form).toBeHidden();

  await page.getByTestId('back-to-run').click();
  await expect(page.getByTestId('task-list')).toBeVisible();
}

/** 集計・転記画面へ移る。 */
async function openSummary(page) {
  await page.getByTestId('nav-summary').click();
  await expect(page.getByTestId('summary-list').or(page.getByTestId('summary-empty'))).toBeVisible();
}

test('T-05 620秒＋320秒＝940秒、転記値16分（A-07）', async ({ page }) => {
  await setup(page, 'PJ-T05');

  // 10分20秒（620秒）と5分20秒（320秒）を同じ作業項目へ入れる。
  await addDirectEntry(page, {
    task: '受入確認',
    minutes: '10',
    seconds: '20',
    note: '前半の計測漏れ',
  });
  await addDirectEntry(page, {
    task: '受入確認',
    minutes: '5',
    seconds: '20',
    note: '後半の計測漏れ',
  });

  await openSummary(page);

  const row = summaryRow(page, '受入確認');
  await expect(row.getByTestId('summary-total-seconds')).toHaveText('940');
  // 940秒 / 60 = 15.67 → 切り上げて16分（仕様書8.6.4）。
  await expect(row.getByTestId('summary-transfer')).toHaveText('16分');
  await expect(page.getByTestId('total-transfer')).toHaveText('16分');
});

test('T-08 未終了区間があると転記値が未確定で集計済みにできない（A-08）', async ({ page }) => {
  await setup(page, 'PJ-T08');

  // 受入確認を開始したまま終了しない。
  const row = taskRow(page, '受入確認');
  await row.getByTestId('row-op-start').click();
  const form = page.getByTestId('op-form');
  await expect(form).toBeVisible();
  await form.getByTestId('op-participants').fill('甲');
  await form.getByTestId('op-participants-add').click();
  await form.getByTestId('op-submit').click();
  await expect(form).toBeHidden();

  await openSummary(page);

  // 行の転記値が未確定である（仕様書8.6.5）。
  await expect(summaryRow(page, '受入確認').getByTestId('summary-transfer')).toContainText(
    '未確定',
  );
  // 実施回合計も未確定だが、確定分の小計は出る。
  await expect(page.getByTestId('total-transfer')).toContainText('未確定');
  await expect(page.getByTestId('total-transfer')).toContainText('小計');

  // 集計済みへは進めず、理由が添えられている（仕様書8.9.6）。
  const button = page.getByTestId('mark-aggregated');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /未終了/);
});

test('未終了区間を終わらせると集計済みへ進める（仕様書8.9.6）', async ({ page }) => {
  await setup(page, 'PJ-CLOSE');

  const row = taskRow(page, '受入確認');
  await row.getByTestId('row-op-start').click();
  const startForm = page.getByTestId('op-form');
  await startForm.getByTestId('op-participants').fill('甲');
  await startForm.getByTestId('op-participants-add').click();
  await startForm.getByTestId('op-submit').click();
  await expect(startForm).toBeHidden();

  await openSummary(page);
  await expect(page.getByTestId('mark-aggregated')).toBeDisabled();

  // 実施回詳細へ戻って終了させる。
  await page.getByTestId('open-run-detail').click();
  await taskRow(page, '受入確認').getByTestId('row-op-finish').click();
  const finishForm = page.getByTestId('op-form');
  await finishForm.getByTestId('op-submit').click();
  await expect(finishForm).toBeHidden();

  await openSummary(page);
  await expect(page.getByTestId('mark-aggregated')).toBeEnabled();
});

test('外部項目コード順に並べ替えられ、未設定は末尾で警告する（仕様書8.7.3、8.7.4）', async ({
  page,
}) => {
  await openFresh(page);
  // 「拡張」は表示順と自然順が食い違う（受入確認 X-100 → 本作業 X-1000 →
  // 追加加工 X-2000 → 検査 X-1100）。
  await createProject(page, { projectId: 'PJ-SORT', variant: '拡張', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });

  await openSummary(page);

  const names = await page.getByTestId('summary-name').allTextContents();
  expect(names).toEqual(['受入確認', '本作業', '検査', '追加加工']);

  await page.getByTestId('summary-sort').selectOption('order');
  const byOrder = await page.getByTestId('summary-name').allTextContents();
  expect(byOrder).toEqual(['受入確認', '本作業', '追加加工', '検査']);
});

test('表示順へ切り替えてもコピーは外部項目コード順になる（仕様書8.7.7、S8-2）', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFresh(page);
  // 「拡張」は表示順と自然順が食い違う。
  await createProject(page, { projectId: 'PJ-COPYSORT', variant: '拡張', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });

  await taskRow(page, '追加加工').getByTestId('open-task').click();
  await page.getByTestId('op-directEntry').click();
  const form = page.getByTestId('direct-form');
  await form.getByTestId('direct-duration-minutes').fill('30');
  await form.getByTestId('direct-note').fill('計測漏れ');
  await form.getByTestId('direct-submit').click();
  await expect(form).toBeHidden();
  await page.getByTestId('back-to-run').click();

  await openSummary(page);
  await page.getByTestId('summary-sort').selectOption('order');
  // 画面は表示順（追加加工 X-2000 が 検査 X-1100 より前）。
  const names = await page.getByTestId('summary-name').allTextContents();
  expect(names).toEqual(['受入確認', '本作業', '追加加工', '検査']);

  await page.getByTestId('copy-transfer').click();
  await expect(page.getByTestId('summary-notice')).toContainText('コピーしました');

  // コピーは画面の並びに関わらず外部項目コード順である。
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  const codes = clipboard.split('\n').map((line) => line.split('\t')[0]);
  expect(codes).toEqual(['X-100', 'X-1000', 'X-1100', 'X-2000']);
});

test('集計済みの後に区間を開始したら転記済みにできない（仕様書7章、S8-1）', async ({ page }) => {
  await setup(page, 'PJ-REOPEN');

  await addDirectEntry(page, { task: '受入確認', minutes: '10', note: '計測漏れ' });
  await openSummary(page);
  await page.getByTestId('mark-aggregated').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('集計済み');

  // 集計済みのまま新しい区間を開始する（集計済みは編集できる状態である）。
  await page.getByTestId('open-run-detail').click();
  await taskRow(page, '本作業').getByTestId('row-op-start').click();
  const startForm = page.getByTestId('op-form');
  await startForm.getByTestId('op-participants').fill('甲');
  await startForm.getByTestId('op-participants-add').click();
  await startForm.getByTestId('op-submit').click();
  await expect(startForm).toBeHidden();

  await openSummary(page);

  // 転記値が未確定になっており、転記済みへは進めない。
  await expect(page.getByTestId('total-transfer')).toContainText('未確定');
  const button = page.getByTestId('mark-transferred');
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute('title', /未終了/);

  // 区間を終わらせれば進める。
  await page.getByTestId('open-run-detail').click();
  await taskRow(page, '本作業').getByTestId('row-op-finish').click();
  const finishForm = page.getByTestId('op-form');
  await finishForm.getByTestId('op-submit').click();
  await expect(finishForm).toBeHidden();

  await openSummary(page);
  await expect(page.getByTestId('mark-transferred')).toBeEnabled();
});

test('外部項目コード未設定を警告する（仕様書8.7.4）', async ({ page }) => {
  await setup(page, 'PJ-MISSING');

  await openSummary(page);

  // サンプルの「後片付け」は外部項目コードが未設定。
  await expect(page.getByTestId('missing-code-warning')).toContainText('1 件');
  await expect(summaryRow(page, '後片付け').getByTestId('summary-code')).toHaveText('（未設定）');
});

test('転記値をタブ区切りでコピーできる（仕様書8.7.7）', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page, 'PJ-COPY');

  await addDirectEntry(page, { task: '受入確認', minutes: '10', note: '計測漏れ' });

  await openSummary(page);
  await page.getByTestId('copy-transfer').click();

  await expect(page.getByTestId('summary-notice')).toContainText('コピーしました');
  // 外部項目コード未設定の「後片付け」は含めない。
  await expect(page.getByTestId('summary-notice')).toContainText('未設定の1件は含めていません');

  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('X-100\t10');
  expect(clipboard).not.toContain('後片付け');
});

test('転記済みへ進め、理由を添えて取り消せる（仕様書7.1、8.7.6、11章）', async ({ page }) => {
  await setup(page, 'PJ-TRANSFER');

  await addDirectEntry(page, { task: '受入確認', minutes: '10', note: '計測漏れ' });
  await openSummary(page);

  // 作業中 → 集計済み。
  await page.getByTestId('mark-aggregated').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('集計済み');

  // 集計済み → 転記済み（仕様書8.7.6）。
  await page.getByTestId('mark-transferred').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('転記済み');

  // 転記済みでは記録を書き換えられない（仕様書7.2）。
  await page.getByTestId('open-run-detail').click();
  await expect(page.getByTestId('run-not-editable')).toContainText('転記済み');
  await openSummary(page);

  // 取り消しには理由が要る（仕様書11章）。
  await page.getByTestId('revert-transfer').click();
  const confirm = page.getByTestId('revert-confirm-panel');
  await expect(confirm).toBeVisible();
  await confirm.getByTestId('revert-confirm').click();
  await expect(confirm.getByTestId('revert-errors')).toContainText('理由');

  await confirm.getByTestId('revert-reason').fill('転記先の数値を誤っていたため');
  await confirm.getByTestId('revert-confirm').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('集計済み');

  // 戻したので再び記録できる。
  await page.getByTestId('open-run-detail').click();
  await expect(page.getByTestId('run-not-editable')).toHaveCount(0);
});

test('転記済みの状態が再読み込み後も残る（仕様書9.1）', async ({ page }) => {
  await setup(page, 'PJ-PERSIST');

  await openSummary(page);
  await page.getByTestId('mark-aggregated').click();
  await page.getByTestId('mark-transferred').click();
  await expect(page.getByTestId('summary-run-status')).toHaveText('転記済み');

  await page.reload();
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  await openSummary(page);

  await expect(page.getByTestId('summary-run-status')).toHaveText('転記済み');
});

test('転記の目印は保存しない（仕様書8.7.5）', async ({ page }) => {
  await setup(page, 'PJ-CHECK');

  await openSummary(page);
  const check = summaryRow(page, '受入確認').getByTestId('summary-check');
  await check.check();
  await expect(check).toBeChecked();
  await expect(page.getByTestId('check-note')).toContainText('保存しない');

  await page.reload();
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').first().click();
  await page.getByTestId('run-row').first().getByTestId('open-run').click();
  await openSummary(page);

  await expect(summaryRow(page, '受入確認').getByTestId('summary-check')).not.toBeChecked();
});
