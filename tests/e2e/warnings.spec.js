/**
 * 警告領域と多重タブ検知のE2E（仕様書8.8、8.10、12.2）。
 *
 * 対応する試験例は T-14（A-13 同一ブラウザで2タブ開くと警告）である。
 * しきい値の1分ごとの再評価（8.8.2）は `page.clock` で時刻を進めて確かめる。
 */

import { expect, test } from '@playwright/test';

import { createProject, createRun, openFresh } from './helpers.js';

const START_TIME = new Date('2026-08-01T09:00:00+09:00');

/**
 * `datetime-local` へ値を入れる（interval.spec.js と同じ理由で秒0を落とす）。
 *
 * @param {import('@playwright/test').Locator} locator
 * @param {string} value
 */
async function fillDateTime(locator, value) {
  await locator.fill(value.replace(/:00$/, ''));
}

/** 案件・実施回を作り、作業項目「受入確認」を開始して未終了区間を1本作る。 */
async function startOpenInterval(page, projectId) {
  await createProject(page, { projectId, totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });

  const row = page.getByTestId('task-row').filter({ hasText: '受入確認' });
  await row.getByTestId('row-op-start').click();
  const form = page.getByTestId('op-form');
  await fillDateTime(form.getByTestId('op-at'), '2026-08-01T09:00:00');
  await form.getByTestId('op-participants').fill('甲');
  await form.getByTestId('op-participants-add').click();
  await form.getByTestId('op-submit').click();
  await expect(form).toBeHidden();
}

test('T-14 同一ブラウザで2タブ開くと警告が出る（A-13）', async ({ page, context }) => {
  await openFresh(page);
  await expect(page.getByTestId('warning-bar')).toBeHidden();

  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByTestId('status-bar')).toBeVisible();

  // 仕様書8.10 が定める文言が両方のタブへ出る。
  const message = '同じデータを別のタブでも開いています。';
  await expect(page.getByTestId('multi-tab-warning')).toContainText(message);
  await expect(second.getByTestId('multi-tab-warning')).toContainText(message);

  // ロックはしない（8.10）。閉じれば警告は畳まれる。
  await second.close();
  await expect(page.getByTestId('multi-tab-warning')).toBeHidden();
});

test('未終了区間が警告領域に出て、リンクで作業項目へ移れる（仕様書8.8.1、12.2）', async ({
  page,
}) => {
  await page.clock.install({ time: START_TIME });
  await openFresh(page);
  await startOpenInterval(page, 'PJ-WARN');

  const bar = page.getByTestId('warning-bar');
  await expect(bar).toBeVisible();
  await expect(page.getByTestId('warning-open-count')).toHaveText('未終了の区間 1件');
  await expect(page.getByTestId('warning-open-link')).toHaveText('PJ-WARN 第1回 受入確認');

  // 別の画面からでもリンクで作業項目詳細へ移れる。
  await page.getByTestId('nav-summary').click();
  await page.getByTestId('warning-open-link').click();
  await expect(page.getByTestId('task-detail-title')).toHaveText('受入確認');

  // 終了すると警告は畳まれる。
  await page.getByTestId('op-finish').click();
  const form = page.getByTestId('op-form');
  await form.getByTestId('op-submit').click();
  await expect(form).toBeHidden();
  await expect(bar).toBeHidden();
});

test('しきい値超過は1分ごとの再評価で現れる（仕様書8.8.2、8.8.3）', async ({ page }) => {
  await page.clock.install({ time: START_TIME });
  await openFresh(page);

  // しきい値を最小の1時間へ変える（8.8.3 設定で変更できる）。
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('long-running-threshold').fill('1');
  await page.getByTestId('save-settings').click();
  await expect(page.getByTestId('settings-message')).toContainText('保存しました');
  await page.getByTestId('nav-projects').click();

  await startOpenInterval(page, 'PJ-THRESH');
  await expect(page.getByTestId('warning-elapsed')).toHaveText('経過 0分');

  // 30分経過。まだ超過ではない。再描画は1分ごとのタイマーだけが行う。
  await page.clock.fastForward('30:00');
  await expect(page.getByTestId('warning-elapsed')).toHaveText('経過 30分');
  await expect(page.getByTestId('warning-open-count')).toHaveText('未終了の区間 1件');

  // さらに31分で1時間を超える。画面の操作なしに強調へ変わる。
  await page.clock.fastForward('31:00');
  await expect(page.getByTestId('warning-elapsed')).toHaveText('経過 1時間1分（しきい値超過）');
  await expect(page.getByTestId('warning-open-count')).toHaveText(
    '未終了の区間 1件（しきい値超過 1件）',
  );
});

test('保存の成否は読み上げ領域で伝える（仕様書9.1、レビュー指摘 D-18）', async ({ page }) => {
  await openFresh(page);

  const status = page.getByTestId('save-status');
  await expect(status).toHaveAttribute('aria-live', 'polite');
  await expect(status).toHaveAttribute('role', 'status');
});

test('ツリーを矢印キーで移動できる（仕様書13章、レビュー指摘 D-18）', async ({ page }) => {
  await openFresh(page);
  await createProject(page, { projectId: 'PJ-KEY', totalQuantity: 100 });
  await createRun(page, { workDate: '2026-08-01', runQuantity: 10 });

  const project = page.getByTestId('tree-project');
  await project.focus();

  // 実施回の作成直後はツリーが展開済みなので、まず ← で折りたたむ。
  await page.keyboard.press('ArrowLeft');
  await expect(project).toHaveAttribute('aria-expanded', 'false');

  // → で展開し、もう一度 → で最初の実施回へ。
  await page.keyboard.press('ArrowRight');
  await expect(project).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('tree-run')).toBeFocused();

  // Enter で選択できる（button の既定動作）。
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-title')).toBeVisible();
});
