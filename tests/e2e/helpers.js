/**
 * E2E で使う共通の手続き。
 *
 * 各試験は IndexedDB を初期化して始める（実装計画8.2）。サンプルテンプレートが
 * 初回投入されるため、テンプレート登録から始めなくても実施回を作れる。
 */

import { expect } from '@playwright/test';

/** サンプルテンプレートの件数（`data/sample-task-templates.json`）。 */
export const SAMPLE_COUNT = 3;

/**
 * 保存済みデータを空にしてから開く。
 *
 * 初期化はこの1本に統一する。試験ファイルごとに別方式を書くと、実行順や
 * `--grep` での単体実行で「前のファイルのデータが残る → 起動ビューが変わる →
 * タイムアウト」という形で落ちる。
 *
 * `deleteDatabase` は使わない。アプリが接続を保持しているあいだは削除が
 * ブロックされ、`onblocked` が返るだけで実際には消えないため、試験間で
 * データが残ってしまう。オブジェクトストアの `clear` は他の接続があっても
 * 通るので、そちらで空にする。
 *
 * テンプレートも消す。再読み込み時にサンプルが投入され直し、初回起動と同じ
 * 状態から始まる（仕様書8.1.6）。設定も消す。`initialize()` が既定値を入れ直す
 * ため（`IndexedDbAdapter`）、設定画面の実装後も試験間で設定が漏れない。
 *
 * @param {import('@playwright/test').Page} page
 */
export async function openFresh(page) {
  await page.goto('/');
  // 起動が済んでデータベースができるまで待つ。
  await expect(page.getByTestId('status-bar')).toBeVisible();

  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('parallel-work-time');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stores = [
      'settings',
      'taskTemplates',
      'projectGroups',
      'workRuns',
      'changeHistory',
    ];
    await new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      for (const name of stores) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });

  await page.reload();
  // 案件が無い状態ではテンプレート画面から始まる。
  await expect(page.getByTestId('template-list')).toBeVisible();
}

/**
 * 案件を登録する（仕様書8.2.1）。
 *
 * 登録に成功すると案件詳細へ移り、実施回追加フォームが開く。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{projectId: string, targetType?: string, variant?: string,
 *          totalQuantity: number}} input
 */
export async function createProject(page, input) {
  const { projectId, targetType = '対象種別A', variant = '標準', totalQuantity } = input;

  await page.getByTestId('new-project').click();
  await expect(page.getByTestId('project-form')).toBeVisible();
  await page.getByTestId('project-id').fill(projectId);
  await page.getByTestId('target-type').fill(targetType);
  await page.getByTestId('variant').fill(variant);
  await page.getByTestId('total-quantity').fill(String(totalQuantity));
  await page.getByTestId('create-project').click();
}

/**
 * 実施回を作成する（仕様書8.2.4、8.3）。
 *
 * 実施回追加フォームが開いていない場合は開く。累計超過の確認が出た場合は
 * `confirmOverflow` で続行するかを決める（仕様書8.9.7）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{workDate: string, runQuantity: number, excludeNames?: string[],
 *          confirmOverflow?: boolean}} input
 */
export async function createRun(page, input) {
  const { workDate, runQuantity, excludeNames = [], confirmOverflow = false } = input;

  const form = page.getByTestId('run-form');
  const toggle = page.getByTestId('add-run-toggle');
  // 案件登録直後は保存が終わるまで案件詳細が描かれない。どちらかが現れるまで
  // 待ってから分岐する。待たずに `isVisible()` を見ると、まだ何も無い時点で
  // 「フォームは閉じている」と判断してトグルを押しに行ってしまう。
  await expect(form.or(toggle)).toBeVisible();
  if (!(await form.isVisible())) {
    await toggle.click();
  }
  await expect(form).toBeVisible();

  await page.getByTestId('work-date').fill(workDate);
  await page.getByTestId('run-quantity-input').fill(String(runQuantity));

  for (const name of excludeNames) {
    await page
      .getByTestId('task-selection')
      .locator('li')
      .filter({ hasText: name })
      .getByTestId('task-include')
      .uncheck();
  }

  await page.getByTestId('create-run').click();

  if (confirmOverflow) {
    await expect(page.getByTestId('overflow-confirm')).toBeVisible();
    await page.getByTestId('confirm-overflow').click();
  }

  // 作成すると、その実施回の詳細へ移る。別の実施回を見るときは
  // `openProject` と `openRun` を使う。
  await expect(page.getByTestId('task-list')).toBeVisible();
}

/**
 * テンプレートを改訂する（仕様書8.1.3）。
 *
 * @param {import('@playwright/test').Page} page
 * @param {{targetType: string, variant: string,
 *          edit: (page: import('@playwright/test').Page) => Promise<void>}} input
 */
export async function reviseTemplate(page, input) {
  await page.getByTestId('nav-templates').click();
  const row = page
    .getByTestId('template-row')
    .filter({ hasText: input.targetType })
    .filter({ hasText: input.variant });
  await row.getByTestId('select-template').click();
  await expect(page.getByTestId('template-editor')).toBeVisible();

  await input.edit(page);

  await page.getByTestId('revise').click();
  await expect(page.getByTestId('editor-heading')).toContainText('版2');
}

/**
 * 案件ツリーから案件を選ぶ。
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} projectId
 */
export async function openProject(page, projectId) {
  await page.getByTestId('nav-projects').click();
  await page.getByTestId('tree-project').filter({ hasText: projectId }).click();
  await expect(page.getByTestId('project-title')).toHaveText(projectId);
}

/**
 * 実施回一覧から n 番目の実施回を開く。
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} index 0起点
 */
export async function openRun(page, index) {
  await page.getByTestId('run-row').nth(index).getByTestId('open-run').click();
  await expect(page.getByTestId('task-list')).toBeVisible();
}

/**
 * 実施回詳細の作業項目名を並び順のまま読む。
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function readTaskNames(page) {
  return page.getByTestId('task-list').getByTestId('task-name').allTextContents();
}

/**
 * 実施回詳細の外部項目コードを並び順のまま読む。
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function readTaskCodes(page) {
  return page.getByTestId('task-list').getByTestId('task-code').allTextContents();
}
