/**
 * テンプレートの複製・アーカイブ・復元・削除のE2E（仕様書8.1.7〜8.1.11）。
 *
 * 登録と改訂は `template.spec.js` が持つ。こちらは版を増やさずに有効版を
 * 出し入れする経路と、レコードを消す経路を実ブラウザで確認する。
 */

import { expect, test } from '@playwright/test';

import { SAMPLE_COUNT, openFresh } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openFresh(page);
});

/**
 * 対象種別A / 標準 の行を返す。
 *
 * @param {import('@playwright/test').Page} page
 */
function standardA(page) {
  return page
    .getByTestId('template-row')
    .filter({ hasText: '対象種別A' })
    .filter({ hasText: '標準' });
}

test.describe('テンプレート自体の項目編集（仕様書8.1.8）', () => {
  test('対象種別とバリエーションを変えて改訂できる', async ({ page }) => {
    await standardA(page).getByTestId('select-template').click();

    await page.getByTestId('editor-variant').fill('標準（改称）');
    await page.getByTestId('revise').click();

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準（改称） 版2');
    await expect(page.getByTestId('template-list')).toContainText('標準（改称）');
  });

  test('既に使われている組み合わせへは改訂できない', async ({ page }) => {
    await standardA(page).getByTestId('select-template').click();

    await page.getByTestId('editor-variant').fill('拡張');
    await page.getByTestId('revise').click();

    await expect(page.getByTestId('template-errors')).toBeVisible();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版1');
  });
});

test.describe('複製（仕様書8.1.7）', () => {
  test('複製すると元の作業項目を持った新規登録フォームが開く', async ({ page }) => {
    await standardA(page).getByTestId('copy-template').click();

    await expect(page.getByTestId('new-template-form')).toBeVisible();
    await expect(page.getByTestId('new-target-type')).toHaveValue('対象種別A');
    await expect(page.getByTestId('new-variant')).toHaveValue('標準');
  });

  test('組み合わせを変えれば版1として登録できる', async ({ page }) => {
    await standardA(page).getByTestId('copy-template').click();
    await page.getByTestId('new-variant').fill('複製版');
    await page.getByTestId('create').click();

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 複製版 版1');
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT + 1);
  });

  test('組み合わせが元のままだと登録できない', async ({ page }) => {
    await standardA(page).getByTestId('copy-template').click();
    await page.getByTestId('create').click();

    await expect(page.getByTestId('template-errors')).toBeVisible();
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
  });
});

test.describe('アーカイブと復元（仕様書8.1.9、8.1.10）', () => {
  test('アーカイブすると一覧から外れ、アーカイブ済みへ移る', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();

    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT - 1);
    await expect(page.getByTestId('archived-row')).toHaveCount(1);
    await expect(page.getByTestId('archived-templates')).toContainText('対象種別A');
  });

  test('アーカイブしても版番号は繰り上がらない', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();

    await expect(page.getByTestId('archived-row')).toContainText('版1');
  });

  test('戻すと一覧へ復帰する', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await expect(page.getByTestId('archived-row')).toHaveCount(1);

    await page.getByTestId('restore-template').click();

    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT);
    await expect(page.getByTestId('archived-templates')).toBeHidden();
  });

  test('アーカイブが再読み込み後も残る（仕様書9.1）', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await expect(page.getByTestId('save-status')).toContainText('保存しました');

    await page.reload();

    await expect(page.getByTestId('archived-row')).toHaveCount(1);
  });

  test('アーカイブ中は同じ組み合わせを新規登録できる', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();

    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-target-type').fill('対象種別A');
    await page.getByTestId('new-variant').fill('標準');
    await page.getByTestId('task-name').last().fill('作業');
    await page.getByTestId('create').click();

    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版1');
  });

  test('組み合わせが埋まっていると戻せない', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await page.getByTestId('new-template-toggle').click();
    await page.getByTestId('new-target-type').fill('対象種別A');
    await page.getByTestId('new-variant').fill('標準');
    await page.getByTestId('task-name').last().fill('作業');
    await page.getByTestId('create').click();
    await expect(page.getByTestId('editor-heading')).toHaveText('対象種別A / 標準 版1');

    await page.getByTestId('restore-template').click();

    await expect(page.getByTestId('template-errors')).toBeVisible();
    await expect(page.getByTestId('archived-row')).toHaveCount(1);
  });
});

test.describe('削除（仕様書8.1.11）', () => {
  test('確認してから消える', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await page.getByTestId('delete-template').click();

    await expect(page.getByTestId('delete-template-confirm-panel')).toBeVisible();
    await page.getByTestId('delete-template-confirm-accept').click();

    await expect(page.getByTestId('archived-templates')).toBeHidden();
    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT - 1);
  });

  test('やめると残る', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await page.getByTestId('delete-template').click();
    await page.getByTestId('delete-template-confirm-cancel').click();

    await expect(page.getByTestId('delete-template-confirm-panel')).toBeHidden();
    await expect(page.getByTestId('archived-row')).toHaveCount(1);
  });

  test('全て削除しても、再読み込みでサンプルが戻らない（仕様書8.1.6）', async ({ page }) => {
    // 全件削除は「テンプレート0件＝初回起動」という判定と衝突しうる。
    const rows = page.getByTestId('template-row');
    for (let remaining = SAMPLE_COUNT; remaining > 0; remaining -= 1) {
      await rows.first().getByTestId('archive-template').click();
      await expect(rows).toHaveCount(remaining - 1);
    }
    for (let remaining = SAMPLE_COUNT; remaining > 0; remaining -= 1) {
      await page.getByTestId('delete-template').first().click();
      await page.getByTestId('delete-template-confirm-accept').click();
      await expect(page.getByTestId('archived-row')).toHaveCount(remaining - 1);
    }
    await expect(rows).toHaveCount(0);

    await page.reload();

    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('archived-templates')).toBeHidden();
  });

  test('削除が再読み込み後も残る（仕様書9.1）', async ({ page }) => {
    await standardA(page).getByTestId('archive-template').click();
    await page.getByTestId('delete-template').click();
    await page.getByTestId('delete-template-confirm-accept').click();
    await expect(page.getByTestId('archived-templates')).toBeHidden();

    await page.reload();

    await expect(page.getByTestId('template-row')).toHaveCount(SAMPLE_COUNT - 1);
    await expect(page.getByTestId('archived-templates')).toBeHidden();
  });
});
